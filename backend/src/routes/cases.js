import { q, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { addEvent, buildArrivalPlan, CN } from '../helpers.js';
import { asyncRouter } from '../asyncify.js';

const r = asyncRouter();
const STAFF = ['reception', 'doctor', 'nurse', 'pharmacy', 'admin'];

async function loadCase(id) {
  const cs = await q(
    `SELECT c.*, p.name AS pet_name, p.species, p.stress_level,
            u.display_name AS owner_name, u.phone AS owner_phone,
            d.display_name AS doctor_name, rm.name AS room_name,
            b.batch_no, vp.name AS vaccine_name
     FROM cases c
     JOIN pets p ON p.id=c.pet_id
     JOIN users u ON u.id=c.owner_id
     LEFT JOIN users d ON d.id=c.doctor_id
     LEFT JOIN rooms rm ON rm.id=c.room_id
     LEFT JOIN vaccine_batches b ON b.id=c.batch_id
     LEFT JOIN vaccine_products vp ON vp.id=b.product_id
     WHERE c.id=$1`, [id]);
  return cs.rows[0];
}

function canAccess(req, cs) {
  return req.user.role !== 'owner' || cs.owner_id === req.user.id;
}

const err = (status, msg) => { const e = new Error(msg); e.status = status; return e; };

// ---------- 病例列表 ----------
r.get('/cases', async (req, res) => {
  const { status, channel } = req.query;
  const params = [];
  let where = [];
  if (req.user.role === 'owner') where.push(`c.owner_id=$${params.push(req.user.id)}`);
  if (req.user.role === 'doctor' && req.query.mine === '1')
    where.push(`c.doctor_id=$${params.push(req.user.id)}`);
  if (req.user.role === 'nurse' && req.query.mine === '1')
    where.push(`c.status IN ('arrived','triaged','hospitalized','in_progress')`);
  if (status) where.push(`c.status=$${params.push(status)}`);
  if (channel) where.push(`c.channel=$${params.push(channel)}`);
  const sql = `
    SELECT c.*, p.name AS pet_name, p.species, u.display_name AS owner_name,
           d.display_name AS doctor_name
    FROM cases c JOIN pets p ON p.id=c.pet_id JOIN users u ON u.id=c.owner_id
    LEFT JOIN users d ON d.id=c.doctor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(c.appointment_at, c.created_at) DESC NULLS LAST LIMIT 200`;
  res.json((await q(sql, params)).rows);
});

// ---------- 新建：预约 / 在线问诊 ----------
r.post('/cases', async (req, res) => {
  const b = req.body;
  if (req.user.role === 'owner' && b.petId) {
    const pet = (await q('SELECT * FROM pets WHERE id=$1', [b.petId])).rows[0];
    if (!pet || pet.owner_id !== req.user.id) throw err(403, '只能为自己的宠物发起');
  }
  if (!['vaccine', 'surgery', 'online'].includes(b.caseType)) throw err(400, '病例类型不合法');
  const caseNo = `C${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(16).slice(2, 7).toUpperCase()}`;
  const cs = await tx(async (c) => {
    // 在线问诊：检查是否已有未关闭的在线病例，复用同一病例，避免重复建档
    if (b.caseType === 'online') {
      const exist = await c.query(
        `SELECT id FROM cases WHERE pet_id=$1 AND channel='online' AND status IN ('booked','in_progress') LIMIT 1`, [b.petId]);
      if (exist.rows[0]) return { reused: exist.rows[0].id };
    }
    const pet = (await c.query('SELECT * FROM pets WHERE id=$1', [b.petId])).rows[0];
    const plan = buildArrivalPlan({ caseType: b.caseType, stressLevel: pet.stress_level });
    const ins = await c.query(
      `INSERT INTO cases (case_no,pet_id,owner_id,case_type,channel,status,appointment_at,
          doctor_id,room_id,batch_id,fasting_hours,preop_required,stress_plan,plan_note,total_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [caseNo, b.petId, pet.owner_id, b.caseType,
       b.caseType === 'online' ? 'online' : 'onsite',
       b.caseType === 'online' ? 'booked' : 'planned',
       b.appointmentAt || null, b.doctorId || null, b.roomId || null, b.batchId || null,
       b.caseType === 'surgery' ? 8 : 0, b.caseType === 'surgery',
       plan, b.note || null, b.fee || 0]);
    const csId = ins.rows[0].id;
    await addEvent(c, {
      caseId: csId, petId: b.petId, type: b.caseType === 'online' ? 'consult' : 'booking',
      authorId: req.user.id, authorRole: req.user.role,
      title: b.caseType === 'online' ? '主人发起图文问诊' : `预约${CN[b.caseType]}`,
      content: b.note || (b.caseType === 'online' ? '主人线上补充病情' : `预约时间 ${b.appointmentAt || '待定'}`),
    });
    if (b.caseType !== 'online') {
      await addEvent(c, {
        caseId: csId, petId: b.petId, type: 'plan', authorRole: 'system',
        title: '系统生成到院计划', content: plan,
        data: { fasting: ins.rows[0].fasting_hours, preop: ins.rows[0].preop_required },
      });
    }
    return { id: csId };
  });
  res.json(cs);
});

// ---------- 病例详情（统一病例） ----------
r.get('/cases/:id', async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (!canAccess(req, cs)) throw err(403, '无权查看该病例');
  const id = cs.id;
  const [events, triages, preops, vacs, surgs, orders, meds, hosps, fus, complaints, cons, invoices, referralsAuth] = await Promise.all([
    q(`SELECT e.*, u.display_name AS author_name FROM case_events e
       LEFT JOIN users u ON u.id=e.author_id
       WHERE e.case_id=$1 AND (e.visible_to_owner=TRUE OR $2='staff')
       ORDER BY e.created_at DESC`, [id, req.user.role === 'owner' ? 'owner' : 'staff']),
    q('SELECT * FROM triages WHERE case_id=$1 ORDER BY id DESC', [id]),
    q('SELECT * FROM preop_exams WHERE case_id=$1 ORDER BY id DESC', [id]),
    q('SELECT * FROM vaccinations WHERE case_id=$1 ORDER BY id DESC', [id]),
    q('SELECT * FROM surgeries WHERE case_id=$1 ORDER BY id DESC', [id]),
    q('SELECT * FROM medical_orders WHERE case_id=$1 ORDER BY id DESC', [id]),
    q('SELECT * FROM medications WHERE case_id=$1 ORDER BY id DESC', [id]),
    q('SELECT h.*, cg.code AS cage_code FROM hospitalizations h LEFT JOIN cages cg ON cg.id=h.cage_id WHERE h.case_id=$1 ORDER BY h.id DESC', [id]),
    q('SELECT * FROM followups WHERE case_id=$1 ORDER BY due_on', [id]),
    q(`SELECT cp.*, u.display_name AS owner_name FROM complaints cp JOIN users u ON u.id=cp.owner_id WHERE cp.case_id=$1 ORDER BY cp.id DESC`, [id]),
    q(`SELECT m.*, u.display_name AS sender_name FROM consultations m JOIN users u ON u.id=m.sender_id
       WHERE m.case_id=$1 ORDER BY m.created_at`, [id]),
    q('SELECT * FROM invoices WHERE case_id=$1 ORDER BY id', [id]),
    q(`SELECT a.*, u.display_name AS owner_name FROM owner_authorizations a
       JOIN users u ON u.id=a.owner_id WHERE a.id=$1`, [cs.auth_id]),
  ]);
  res.json({
    case: cs,
    events: events.rows, triages: triages.rows, preops: preops.rows,
    vaccinations: vacs.rows, surgeries: surgs.rows, orders: orders.rows,
    medications: meds.rows, hospitalizations: hosps.rows, followups: fus.rows,
    complaints: complaints.rows, consultations: cons.rows, invoices: invoices.rows,
    authorization: referralsAuth.rows[0] || null,
  });
});

// ---------- 调整到院计划（排班/诊室/批号/禁食/应激） ----------
r.post('/cases/:id/plan', requireRole('reception', 'doctor', 'admin'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const b = req.body;
  await tx(async (c) => {
    await c.query(
      `UPDATE cases SET doctor_id=COALESCE($2,doctor_id), room_id=COALESCE($3,room_id),
         batch_id=COALESCE($4,batch_id), fasting_hours=COALESCE($5,fasting_hours),
         preop_required=COALESCE($6,preop_required), stress_plan=COALESCE($7,stress_plan),
         plan_note=COALESCE($8,plan_note), appointment_at=COALESCE($9,appointment_at),
         status='planned' WHERE id=$1`,
      [cs.id, b.doctorId ?? null, b.roomId ?? null, b.batchId ?? null,
       b.fastingHours ?? null, b.preopRequired ?? null, b.stressPlan ?? null,
       b.planNote ?? null, b.appointmentAt ?? null]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'plan', authorId: req.user.id,
      authorRole: req.user.role, title: '到院计划已更新',
      content: [b.appointmentAt && `预约 ${b.appointmentAt}`, b.doctorId && '已安排主刀/接种医生',
                b.batchId && '已锁定疫苗批号', b.stressPlan].filter(Boolean).join('；') || '计划调整' });
  });
  res.json({ ok: true });
});

// ---------- 前台到院核验：身份 / 代办授权 / 费用 ----------
r.post('/cases/:id/checkin', requireRole('reception', 'admin'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (cs.channel === 'online') throw err(400, '在线问诊病例无需到院核验');
  const b = req.body;
  let authOk = true; let authId = null;
  if (b.authCode) {
    const au = (await q(
      `SELECT * FROM owner_authorizations WHERE auth_code=$1 AND revoked=FALSE
       AND valid_from<=now() AND valid_until>=now()
       AND (pet_id IS NULL OR pet_id=$2)`, [b.authCode, cs.pet_id])).rows[0];
    if (!au) throw err(400, '代办授权码无效或已过期（主人代办核验失败）');
    authOk = true; authId = au.id;
  }
  if (!b.identityVerified) throw err(400, '必须先核验宠物身份（芯片号/外貌比对）');
  await tx(async (c) => {
    await c.query(
      `UPDATE cases SET status='arrived', check_in_at=now(), identity_verified=TRUE,
         auth_verified=$2, auth_id=$3, fee_verified=$4, reception_note=$5 WHERE id=$1`,
      [cs.id, authOk, authId, !!b.feeVerified, b.note || null]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'checkin', authorId: req.user.id,
      authorRole: req.user.role, title: '前台到院核验通过',
      content: `身份核验✓ ${b.authCode ? '代办授权码 ' + b.authCode + ' ✓' : '主人本人到场 ✓'} 费用确认${b.feeVerified ? '✓' : '✗（待补费）'}` });
  });
  res.json({ ok: true });
});

// ---------- 主人/前台改约 ----------
r.post('/cases/:id/reschedule', async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (!canAccess(req, cs) && req.user.role !== 'reception') throw err(403, '无权操作');
  const { appointmentAt, reason } = req.body;
  await tx(async (c) => {
    await c.query(`UPDATE cases SET appointment_at=$2, status='planned' WHERE id=$1`, [cs.id, appointmentAt]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'remark', authorId: req.user.id,
      authorRole: req.user.role, title: '主人临时改约', content: `改约至 ${appointmentAt}。原因：${reason || '未填写'}` });
  });
  res.json({ ok: true });
});

// ---------- 护士分诊 ----------
r.post('/cases/:id/triage', requireRole('nurse', 'doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (!['arrived', 'triaged'].includes(cs.status)) throw err(400, '宠物尚未到院核验，无法分诊');
  const b = req.body;
  const fever = (b.tempC || 0) >= 39.5;
  const suitable = !fever && b.suitable !== false;
  let decision = b.decision || 'proceed';
  if (fever) decision = 'hold_fever';
  await tx(async (c) => {
    await c.query(
      `INSERT INTO triages (case_id,nurse_id,temp_c,weight_kg,spirit,appetite,suitable,decision,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cs.id, req.user.id, b.tempC, b.weightKg, b.spirit || 'normal', b.appetite || null,
       suitable, decision, b.note || null]);
    await c.query('UPDATE pets SET weight_kg=$2 WHERE id=$1', [cs.pet_id, b.weightKg || cs.weight_kg]);
    if (!suitable) {
      await c.query(`UPDATE cases SET status='contraindicated' WHERE id=$1`, [cs.id]);
      await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'triage', authorId: req.user.id,
        authorRole: req.user.role, title: fever ? '分诊发现发热，暂缓处置' : '分诊判定暂不适合处置',
        content: `体温 ${b.tempC}℃，精神 ${b.spirit}。${b.note || ''} 已请医生评估并与主人沟通改期。` });
    } else {
      await c.query(`UPDATE cases SET status='triaged' WHERE id=$1`, [cs.id]);
      await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'triage', authorId: req.user.id,
        authorRole: req.user.role, title: '护士分诊完成，适合处置',
        content: `体温 ${b.tempC}℃，体重 ${b.weightKg}kg，精神 ${b.spirit}。${b.note || ''}` });
    }
  });
  res.json({ ok: true, suitable, decision });
});

// ---------- 术前检查 ----------
r.post('/cases/:id/preop', requireRole('doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (cs.case_type !== 'surgery') throw err(400, '仅手术病例需要术前检查');
  const b = req.body;
  const abnormal = [b.cbc, b.biochem, b.clotting].includes('abnormal');
  const result = b.result || (abnormal ? 'abnormal' : 'normal');
  const fit = b.fitForAnesthesia === true && result === 'normal';
  await tx(async (c) => {
    await c.query(
      `INSERT INTO preop_exams (case_id,doctor_id,cbc,biochem,clotting,result,fit_for_anesthesia,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cs.id, req.user.id, b.cbc || 'normal', b.biochem || 'normal', b.clotting || 'normal',
       result, fit, b.note || null]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'preop', authorId: req.user.id,
      authorRole: req.user.role,
      title: result === 'abnormal' ? '术前检查异常，暂停手术' : '术前检查正常，可安排麻醉',
      content: `血常规 ${b.cbc} / 生化 ${b.biochem} / 凝血 ${b.clotting}。${b.note || ''}` });
    if (result === 'abnormal') await c.query(`UPDATE cases SET status='contraindicated' WHERE id=$1`, [cs.id]);
  });
  res.json({ ok: true, result, fitForAnesthesia: fit });
});

// ---------- 接种（含批号/冷链/缺货联动） ----------
r.post('/cases/:id/vaccinate', requireRole('doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (cs.case_type !== 'vaccine') throw err(400, '该病例不是疫苗接种病例');
  const b = req.body;
  const batchId = b.batchId || cs.batch_id;
  if (!batchId) throw err(400, '请选择疫苗批号');
  const batch = (await q(
    `SELECT b.*, p.name AS product_name FROM vaccine_batches b JOIN vaccine_products p ON p.id=b.product_id WHERE b.id=$1`,
    [batchId])).rows[0];
  if (!batch) throw err(400, '疫苗批号不存在');
  if (batch.status === 'shortage') throw err(409, `疫苗缺货：${batch.product_name}（批号 ${batch.batch_no}）库存不足，请药房调剂或与主人改约`);
  if (batch.status === 'cold_chain_break') throw err(409, `冷链中断：批号 ${batch.batch_no} 曾脱离 ${batch.storage_temp_lo}~${batch.storage_temp_hi}℃ 冷链，禁止接种`);
  if (batch.status === 'expired' || new Date(batch.expire_on) < new Date(new Date().toDateString()))
    throw err(409, `批号 ${batch.batch_no} 已过期，禁止接种`);
  if (batch.status === 'recall') throw err(409, `批号 ${batch.batch_no} 已被召回，禁止接种`);
  if (batch.qty_in - batch.qty_used <= 0) throw err(409, '该批号可用库存为 0');
  const triage = (await q(`SELECT * FROM triages WHERE case_id=$1 ORDER BY id DESC LIMIT 1`, [cs.id])).rows[0];
  if (!triage || !triage.suitable) throw err(400, '护士分诊未完成或判定暂不适合接种');
  if (cs.status === 'contraindicated') throw err(400, '病例存在暂缓标记，请先解除');

  const due = b.nextDueOn || null;
  await tx(async (c) => {
    const used = await c.query(
      `UPDATE vaccine_batches SET qty_used=qty_used+1 WHERE id=$1 AND qty_in-qty_used>0 RETURNING qty_in,qty_used`,
      [batchId]);
    if (!used.rows[0]) throw err(409, '扣减库存失败，可能已被占用');
    await c.query(
      `INSERT INTO vaccinations (case_id,pet_id,batch_id,doctor_id,vaccine_name,dose_no,site,next_due_on,adverse)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cs.id, cs.pet_id, batchId, req.user.id, batch.product_name, b.doseNo || 1,
       b.site || '颈部皮下', due, b.adverse || null]);
    await c.query(
      `INSERT INTO pet_vaccine_history (pet_id,vaccine_name,dose_no,vaccinated_on,next_due_on,hospital,batch_no)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,'城市宠物医院总院',$5)`,
      [cs.pet_id, batch.product_name, b.doseNo || 1, due, batch.batch_no]);
    if (due) await c.query(
      `INSERT INTO reminders (pet_id,case_id,kind,title,due_on,status)
       VALUES ($1,$2,'vaccine',$3,$4,'pending')`,
      [cs.pet_id, cs.id, `${batch.product_name} 第 ${(b.doseNo || 1) + 1} 针提醒`, due]);
    await c.query(`UPDATE cases SET status='completed', batch_id=$2 WHERE id=$1`, [cs.id, batchId]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'vaccination', authorId: req.user.id,
      authorRole: req.user.role, title: `${batch.product_name} 接种完成`,
      content: `批号 ${batch.batch_no}（冷链 ${batch.storage_temp_lo}~${batch.storage_temp_hi}℃ 正常），部位 ${b.site || '颈部皮下'}，${due ? '下一针 ' + due : '免疫程序完成'}。留观 20 分钟。`,
      data: { batchNo: batch.batch_no, nextDue: due } });
  });
  res.json({ ok: true });
});

// ---------- 手术记录 ----------
r.post('/cases/:id/surgery', requireRole('doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (cs.case_type !== 'surgery') throw err(400, '该病例不是手术病例');
  const b = req.body;
  const preop = (await q(`SELECT * FROM preop_exams WHERE case_id=$1 ORDER BY id DESC LIMIT 1`, [cs.id])).rows[0];
  if (!preop) throw err(400, '术前检查未完成');
  if (preop.result === 'abnormal' || preop.fit_for_anesthesia !== true)
    throw err(409, '术前检查异常或未判定可麻醉，不能手术');
  const triage = (await q(`SELECT * FROM triages WHERE case_id=$1 ORDER BY id DESC LIMIT 1`, [cs.id])).rows[0];
  if (!triage || !triage.suitable) throw err(400, '护士分诊未通过');
  await tx(async (c) => {
    await c.query(
      `INSERT INTO surgeries (case_id,pet_id,doctor_id,surgery_name,anesthesia,started_at,finished_at,elizabeth_collar,collar_fit,note)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,now()),COALESCE($7,now()),$8,$9,$10)`,
      [cs.id, cs.pet_id, req.user.id, b.surgeryName, b.anesthesia || '吸入麻醉',
       b.startedAt || null, b.finishedAt || null, b.collar !== false, b.collarFit || '尺寸合适', b.note || null]);
    await c.query(`UPDATE cases SET status='in_progress' WHERE id=$1`, [cs.id]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'surgery', authorId: req.user.id,
      authorRole: req.user.role, title: `${b.surgeryName} 手术完成`,
      content: `麻醉方式：${b.anesthesia || '吸入麻醉'}；已佩戴伊丽莎白圈（${b.collarFit || '尺寸合适'}）；${b.note || ''}` });
  });
  res.json({ ok: true });
});

// ---------- 医嘱 + 处方 ----------
r.post('/cases/:id/orders', requireRole('doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const b = req.body;
  await tx(async (c) => {
    await c.query(`INSERT INTO medical_orders (case_id,doctor_id,content,revisit_on) VALUES ($1,$2,$3,$4)`,
      [cs.id, req.user.id, b.content, b.revisitOn || null]);
    for (const m of b.medications || []) {
      await c.query(
        `INSERT INTO medications (case_id,drug_name,dosage,frequency,days,qty,note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cs.id, m.drugName, m.dosage || null, m.frequency || null, m.days || null, m.qty || 1, m.note || null]);
    }
    if (b.revisitOn) await c.query(
      `INSERT INTO reminders (pet_id,case_id,kind,title,due_on) VALUES ($1,$2,'revisit',$3,$4)`,
      [cs.pet_id, cs.id, `复诊提醒（${cs.case_type === 'surgery' ? '术后拆线/复查' : '接种后复查'}）`, b.revisitOn]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'order', authorId: req.user.id,
      authorRole: req.user.role, title: '医生开具医嘱',
      content: b.content + ((b.medications || []).length ? `；处方 ${b.medications.map(m => m.drugName).join('、')}` : '') +
               (b.revisitOn ? `；复诊 ${b.revisitOn}` : '') });
  });
  res.json({ ok: true });
});

// ---------- 药房发药 / 用药不配合 ----------
r.post('/cases/:id/dispense/:medId', requireRole('pharmacy'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const med = (await q('SELECT * FROM medications WHERE id=$1 AND case_id=$2', [req.params.medId, cs.id])).rows[0];
  if (!med) throw err(404, '处方药品不存在');
  if (med.status !== 'prescribed') throw err(400, '该药品已处理');
  const { compliance = 'normal', note, refused } = req.body || {};
  await tx(async (c) => {
    await c.query(
      `UPDATE medications SET status=$2, compliance=$3, dispensed_at=now(), pharmacist_id=$4, note=COALESCE($5,note)
       WHERE id=$1`,
      [med.id, refused ? 'refused' : 'dispensed', compliance, req.user.id, note || null]);
    if (compliance !== 'normal' && !refused) {
      await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'medication', authorId: req.user.id,
        authorRole: req.user.role, title: '⚠ 用药不配合，已在病例中标注',
        content: `${med.drug_name}：${ {resists:'抗拒躲闪', spits:'喂后吐出', needs_assist:'需主人辅助喂药'}[compliance] || compliance }。${note || ''} 已通知医生调整给药方式。` });
    } else {
      await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'medication', authorId: req.user.id,
        authorRole: req.user.role, title: refused ? '主人拒取药品' : '药房发药完成',
        content: `${med.drug_name} × ${med.qty}，用法 ${med.dosage || ''} ${med.frequency || ''}。${note || ''}` });
    }
  });
  res.json({ ok: true });
});

// ---------- 住院安排笼位 ----------
r.post('/cases/:id/hospitalize', requireRole('nurse', 'doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const { cageId, note } = req.body;
  const cage = (await q('SELECT * FROM cages WHERE id=$1', [cageId])).rows[0];
  if (!cage || cage.status !== 'free') throw err(409, '该笼位不可用（占用/清洁中）');
  await tx(async (c) => {
    await c.query(`UPDATE cages SET status='occupied', current_pet_id=$2 WHERE id=$1`, [cageId, cs.pet_id]);
    await c.query(
      `INSERT INTO hospitalizations (case_id,pet_id,cage_id,note) VALUES ($1,$2,$3,$4)`,
      [cs.id, cs.pet_id, cageId, note || null]);
    await c.query(`UPDATE cases SET status='hospitalized' WHERE id=$1`, [cs.id]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'hospitalization', authorId: req.user.id,
      authorRole: req.user.role, title: `术后住院，安排笼位 ${cage.code}`,
      content: `笼位 ${cage.code}（${cage.size} 号）；${note || '按术后护理级别观察'}` });
  });
  res.json({ ok: true });
});

// ---------- 术后伤口 / 伊丽莎白圈巡查 ----------
r.post('/cases/:id/wound', requireRole('nurse', 'doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const { status, collar, note } = req.body;
  await tx(async (c) => {
    await c.query(`UPDATE surgeries SET wound_status=$2, elizabeth_collar=COALESCE($3,elizabeth_collar)
                   WHERE id=(SELECT id FROM surgeries WHERE case_id=$1 ORDER BY id DESC LIMIT 1)`,
      [cs.id, status, collar ?? null]);
    await c.query(
      `UPDATE hospitalizations SET wound_check=$2 WHERE case_id=$1 AND status='admitted'`,
      [cs.id, `${status}:${note || ''}`]);
    const alert = status === 'bleeding' ? '术后伤口渗血，已紧急通知主管医生处理'
      : status === 'ooze' ? '伤口少量渗液，加强观察'
      : status === 'infected' ? '伤口疑似感染，请医生评估' : '伤口干燥愈合良好';
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'remark', authorId: req.user.id,
      authorRole: req.user.role,
      title: status === 'ok' ? '术后伤口巡查正常' : `⚠ 伤口异常：${ {bleeding:'渗血',ooze:'渗液',infected:'感染'}[status] }`,
      content: `${alert}；伊丽莎白圈${collar === false ? '已脱落/被挣脱，已重新佩戴' : '佩戴正常'}。${note || ''}` });
  });
  res.json({ ok: true });
});

// ---------- 出院 ----------
r.post('/cases/:id/discharge', requireRole('nurse', 'doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const { note } = req.body || {};
  await tx(async (c) => {
    const h = await c.query(
      `UPDATE hospitalizations SET status='discharged', discharged_at=now(), note=COALESCE($2,note)
       WHERE case_id=$1 AND status='admitted' RETURNING cage_id`, [cs.id, note || null]);
    if (h.rows[0]) await c.query(`UPDATE cages SET status='cleaning', current_pet_id=NULL WHERE id=$1`, [h.rows[0].cage_id]);
    await c.query(`UPDATE cases SET status='discharged' WHERE id=$1`, [cs.id]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'hospitalization', authorId: req.user.id,
      authorRole: req.user.role, title: '宠物康复出院', content: note || '笼位转为清洁状态，等待护士终末消毒' });
  });
  res.json({ ok: true });
});

// ---------- 术后回访 ----------
r.post('/cases/:id/followup', requireRole('nurse', 'doctor', 'admin'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const b = req.body;
  await tx(async (c) => {
    await c.query(
      `INSERT INTO followups (case_id,pet_id,due_on,channel,result,abnormal)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cs.id, cs.pet_id, b.dueOn || new Date().toISOString().slice(0, 10),
       b.channel || 'phone', b.result, b.abnormal || null]);
    if (b.result === 'good') {
      await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'followup', authorId: req.user.id,
        authorRole: req.user.role, title: '术后/接种后回访：恢复良好',
        content: `回访渠道 ${b.channel || '电话'}；${b.abnormal || '主人反馈精神食欲正常，伤口愈合好'}` });
      if (cs.status === 'discharged') await c.query(`UPDATE cases SET status='completed' WHERE id=$1`, [cs.id]);
    } else if (b.result === 'abnormal') {
      await c.query(
        `INSERT INTO reminders (pet_id,case_id,kind,title,due_on) VALUES ($1,$2,'followup',$3,CURRENT_DATE)`,
        [cs.pet_id, cs.id, '回访异常：建议尽快到院复查']);
      await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'feedback', authorId: req.user.id,
        authorRole: req.user.role, title: '⚠ 回访发现异常，已生成复查提醒',
        content: b.abnormal || '主人反馈异常情况', visible: true });
    } else {
      await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'followup', authorId: req.user.id,
        authorRole: req.user.role, title: `回访结果：${ {concern:'主人有疑虑',unreachable:'未能联系上'}[b.result] }`,
        content: b.abnormal || '' });
    }
  });
  res.json({ ok: true });
});

r.post('/cases/:id/followups/plan', requireRole('nurse', 'doctor'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  const { dueOn, channel } = req.body;
  await tx(async (c) => {
    await c.query(`INSERT INTO followups (case_id,pet_id,due_on,channel) VALUES ($1,$2,$3,$4)`,
      [cs.id, cs.pet_id, dueOn, channel || 'phone']);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'followup', authorId: req.user.id,
      authorRole: req.user.role, title: `已安排 ${dueOn} 术后回访`, content: `渠道：${channel || '电话'}` });
  });
  res.json({ ok: true });
});

// ---------- 在线图文问诊（并入同一病例） ----------
r.post('/cases/:id/consult', async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (!canAccess(req, cs) && !STAFF.includes(req.user.role)) throw err(403, '无权发言');
  const role = req.user.role === 'owner' ? 'owner' : req.user.role;
  const { msgType = 'text', content, imageUrl } = req.body;
  if (!content && !imageUrl) throw err(400, '消息内容为空');
  await tx(async (c) => {
    await c.query(
      `INSERT INTO consultations (case_id,sender_id,sender_role,msg_type,content) VALUES ($1,$2,$3,$4,$5)`,
      [cs.id, req.user.id, role, msgType, imageUrl ? `[图片] ${content}` : content]);
    // 医生首次回复 = 接诊；线上信息自动进入病例时间线，到院时医生无需重复询问
    if (role === 'doctor' && cs.status === 'booked')
      await c.query(`UPDATE cases SET doctor_id=$2, status='in_progress' WHERE id=$1`, [cs.id, req.user.id]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'consult', authorId: req.user.id,
      authorRole: role, title: role === 'owner' ? '主人线上补充病情' : '医生线上回复',
      content: imageUrl ? `[图片] ${content}` : content,
      data: imageUrl ? { imageUrl } : null });
  });
  res.json({ ok: true });
});

// 医生把在线问诊转为到院（线上病情自动带入同一病例）
r.post('/cases/:id/to-onsite', requireRole('doctor', 'reception', 'admin'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (cs.channel !== 'online') throw err(400, '该病例不是在线问诊');
  const { appointmentAt, caseType = 'followup' } = req.body;
  await tx(async (c) => {
    await c.query(
      `UPDATE cases SET channel='onsite', case_type=$2, appointment_at=$3, status='planned' WHERE id=$1`,
      [cs.id, caseType, appointmentAt]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'referral', authorId: req.user.id,
      authorRole: req.user.role, title: '线上问诊转为到院检查',
      content: `到院时间 ${appointmentAt}；此前图文咨询记录已并入本病例，医生无需重复询问病史。` });
  });
  res.json({ ok: true });
});

// ---------- 术后照片上传（base64，进入长期档案） ----------
r.post('/cases/:id/photo', async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (!canAccess(req, cs) && !STAFF.includes(req.user.role)) throw err(403, '无权上传');
  const { dataUrl, caption } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) throw err(400, '图片格式不正确');
  await tx(async (c) => {
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'photo', authorId: req.user.id,
      authorRole: req.user.role,
      title: req.user.role === 'owner' ? '主人上传术后照片' : '医护上传伤口照片',
      content: caption || '', data: { imageUrl: dataUrl.slice(0, 900000) } });
  });
  res.json({ ok: true });
});

// ---------- 跨院转诊 ----------
r.post('/cases/:id/refer', requireRole('doctor', 'admin'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  const { hospital, reason } = req.body;
  await tx(async (c) => {
    await c.query(`UPDATE cases SET status='referred', referral_out_hospital=$2, referral_reason=$3 WHERE id=$1`,
      [cs.id, hospital, reason]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'referral', authorId: req.user.id,
      authorRole: req.user.role, title: `跨院转诊至 ${hospital}`,
      content: `转诊原因：${reason}；完整病例（问诊/检查/医嘱/照片）已打包供接收医院调阅。` });
  });
  res.json({ ok: true });
});

// ---------- 投诉（收费等） ----------
r.post('/cases/:id/complaint', async (req, res) => {
  const cs = await loadCase(req.params.id);
  if (!cs) throw err(404, '病例不存在');
  if (!canAccess(req, cs)) throw err(403, '只有主人可就该病例发起投诉');
  const { topic = 'billing', content } = req.body;
  if (!content) throw err(400, '请填写投诉内容');
  await tx(async (c) => {
    await c.query(`INSERT INTO complaints (case_id,owner_id,topic,content) VALUES ($1,$2,$3,$4)`,
      [cs.id, cs.owner_id, topic, content]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'complaint', authorId: req.user.id,
      authorRole: 'owner', title: `主人投诉（${ {billing:'收费',service:'服务',quality:'医疗质量',other:'其他'}[topic] }）`,
      content });
  });
  res.json({ ok: true });
});

// ---------- 收费 ----------
r.post('/cases/:id/billing', requireRole('reception', 'admin'), async (req, res) => {
  const cs = await loadCase(req.params.id);
  const { items, paid } = req.body;
  await tx(async (c) => {
    let total = 0;
    for (const it of items || []) {
      await c.query(`INSERT INTO invoices (case_id,item,amount) VALUES ($1,$2,$3)`, [cs.id, it.item, it.amount]);
      total += Number(it.amount);
    }
    await c.query(`UPDATE cases SET total_fee=total_fee+$2, fee_paid=COALESCE($3,fee_paid) WHERE id=$1`,
      [cs.id, total, paid ?? null]);
    await addEvent(c, { caseId: cs.id, petId: cs.pet_id, type: 'billing', authorId: req.user.id,
      authorRole: req.user.role, title: paid ? '费用已结清' : '新增收费项目',
      content: (items || []).map(i => `${i.item} ¥${i.amount}`).join('；') + `；合计新增 ¥${total}` });
  });
  res.json({ ok: true });
});

export default r;
