/* 种子数据：六个角色账号 + 猫狗档案 + 进行中各场景病例 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'pethospital',
  user: process.env.DB_USER || 'pet',
  password: process.env.DB_PASSWORD || 'petpass',
});

const hash = (p) => bcrypt.hashSync(p, 10);

async function main() {
  const q = (t, p = []) => pool.query(t, p);
  await q(`TRUNCATE users, pets, pet_vaccine_history, pet_deworming, rooms, doctor_schedules, cages,
    vaccine_products, vaccine_batches, cases, case_events, triages, preop_exams, vaccinations,
    surgeries, medical_orders, medications, hospitalizations, followups, complaints, consultations,
    reminders, invoices, owner_authorizations RESTART IDENTITY CASCADE`);

  // ---- 用户 ----
  const users = [
    ['wangmeili', '王美丽', 'owner', '13800001111', '宠物主人'],
    ['lizhiqiang', '李志强', 'owner', '13800002222', '宠物主人'],
    ['zhangmin', '张敏', 'reception', '13900001001', '前台主管'],
    ['chenaisi', '陈爱思', 'doctor', '13900002001', '主治医师（猫科/软组织外科）'],
    ['wangdafu', '王大福', 'doctor', '13900002002', '主治医师（犬科）'],
    ['huxiaojing', '胡小静', 'nurse', '13900003001', '护士长'],
    ['liuyao', '刘药', 'pharmacy', '13900004001', '药房/冷链管理员'],
    ['zhouyuan', '周院长', 'admin', '13900005001', '院长'],
  ];
  const id = {};
  for (const [u, name, role, phone, title] of users) {
    const r = await q(
      `INSERT INTO users (username,password_hash,display_name,role,phone,title)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [u, hash('123456'), name, role, phone, title]);
    id[u] = r.rows[0].id;
  }

  // ---- 诊室 ----
  for (const [name, type] of [['1号诊室', 'consult'], ['2号诊室', 'consult'], ['手术室', 'surgery'], ['留观室', 'observation']])
    await q(`INSERT INTO rooms (name,room_type) VALUES ($1,$2)`, [name, type]);

  // ---- 排班（今天起 5 天）----
  for (let d = 0; d < 5; d++) {
    await q(`INSERT INTO doctor_schedules (doctor_id,work_date,start_time,end_time)
             VALUES ($1,CURRENT_DATE+${d},'09:00','12:00'),($1,CURRENT_DATE+${d},'14:00','17:30'),
                    ($2,CURRENT_DATE+${d},'09:30','12:30'),($2,CURRENT_DATE+${d},'14:30','18:00')`,
      [id.chenaisi, id.wangdafu]);
  }

  // ---- 笼位 ----
  await q(`INSERT INTO cages (code,size,status) VALUES ('C01','S','free'),('C02','M','cleaning'),
           ('C03','M','occupied'),('C04','L','free'),('C05','S','free')`);

  // ---- 疫苗产品 / 批号 ----
  const vp = async (name, species, maker, total) =>
    (await q(`INSERT INTO vaccine_products (name,species,maker,dose_total) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, species, maker, total])).rows[0].id;
  const cat3 = await vp('妙三多（猫三联）', 'cat', '硕腾', 3);
  const rab = await vp('瑞比克狂犬疫苗', 'both', '硕腾', 1);
  const dog4 = await vp('犬四联疫苗', 'dog', '英特威', 3);
  const batch = async (pid, no, exp, inn, used, status, note) =>
    (await q(`INSERT INTO vaccine_batches (product_id,batch_no,expire_on,qty_in,qty_used,status,cold_chain_note)
              VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [pid, no, exp, inn, used, status, note])).rows[0].id;
  const bCat3a = await batch(cat3, 'M3202604A', '2027-04-30', 12, 3, 'normal', null);
  const bCat3Cold = await batch(cat3, 'M3202507C', '2027-01-31', 10, 1, 'cold_chain_break',
    '9月5日运输途中冷藏箱温度升至11.8℃持续约40分钟，已封存待评估');
  const bRab = await batch(rab, 'R20260115', '2027-06-30', 30, 8, 'normal', null);
  await batch(dog4, 'D20260220', '2027-02-28', 6, 6, 'shortage', '库存清零，采购在途，预计3天后到货');
  const bDog4 = await batch(dog4, 'D20260801', '2027-08-31', 4, 0, 'normal', null);

  // ---- 宠物档案 ----
  const pet = async (o) =>
    (await q(`INSERT INTO pets (owner_id,name,species,breed,gender,birth_date,age_months,weight_kg,
        neutered,microchip_no,allergies,chronic_diseases,stress_level,temper_note,lost_status,lost_note,lost_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [o.owner, o.name, o.species, o.breed, o.gender, o.birth, o.age, o.weight, o.neutered,
       o.chip || null, o.allergy || '', o.chronic || '', o.stress || 1, o.temper || '',
       o.lost || 'none', o.lostNote || null, o.lost ? new Date() : null])).rows[0].id;

  const naigai = await pet({ owner: id.wangmeili, name: '奶盖', species: 'cat', breed: '英国短毛猫（蓝猫）',
    gender: 'female', birth: '2025-08-20', age: 13, weight: 3.42, neutered: true,
    chip: '900111222333001', allergy: '青霉素类药物过敏（注射后皮疹）', stress: 4,
    temper: '怕生、易应激，候诊易哈气' });
  const doudou = await pet({ owner: id.wangmeili, name: '豆豆', species: 'dog', breed: '威尔士柯基',
    gender: 'male', birth: '2024-06-15', age: 27, weight: 12.8, neutered: false,
    chip: '900111222333002', chronic: '轻度髌骨脱位（二级），避免剧烈跳跃', stress: 2, temper: '活泼亲人' });
  const mimi = await pet({ owner: id.lizhiqiang, name: '咪咪', species: 'cat', breed: '中华田园橘猫',
    gender: 'female', birth: '2018-03-10', age: 102, weight: 5.1, neutered: true,
    chip: '900444555666001', allergy: '无', chronic: '慢性肾病二期（CKD II），长期处方粮', stress: 3,
    temper: '温顺', lost: 'missing', lostNote: '9月12日晚从家中跑出未归，已在小区张贴寻猫启事' });
  const niangao = await pet({ owner: id.lizhiqiang, name: '年糕', species: 'dog', breed: '金毛寻回犬',
    gender: 'male', birth: '2023-05-01', age: 40, weight: 28.6, neutered: false,
    chip: '900444555666002', stress: 1, temper: '温顺配合' });
  const meiqiu = await pet({ owner: id.lizhiqiang, name: '煤球', species: 'cat', breed: '中华田园黑猫',
    gender: 'male', birth: '2025-05-01', age: 16, weight: 4.3, neutered: true,
    chip: '900444555666003', stress: 5, temper: '极度胆小，运输易尿闭' });

  await q(`UPDATE cages SET current_pet_id=$1 WHERE code='C03'`, [niangao]);

  // 既往疫苗 / 驱虫
  await q(`INSERT INTO pet_vaccine_history (pet_id,vaccine_name,dose_no,vaccinated_on,next_due_on,hospital,batch_no)
   VALUES ($1,'妙三多（猫三联）',1,CURRENT_DATE-28,CURRENT_DATE+7,'本院','M3202604A'),
          ($2,'瑞比克狂犬疫苗',1,CURRENT_DATE-300,NULL,'伴侣动物医院','R20250301'),
          ($3,'犬四联疫苗',2,CURRENT_DATE-40,CURRENT_DATE+20,'本院','D20260220'),
          ($4,'妙三多（猫三联）',2,CURRENT_DATE-8,NULL,'本院','M3202507C')`,
    [naigai, doudou, niangao, meiqiu]);
  await q(`INSERT INTO pet_deworming (pet_id,product,dewormed_on,next_due_on,kind)
   VALUES ($1,'大宠爱',CURRENT_DATE-31,CURRENT_DATE+1,'both'),
          ($2,'尼可信',CURRENT_DATE-60,CURRENT_DATE-29,'external')`,
    [naigai, niangao]);

  // ---- 代办授权 ----
  await q(`INSERT INTO owner_authorizations (owner_id,pet_id,agent_name,agent_phone,auth_code,scope,valid_until)
   VALUES ($1,$2,'王建国（主人父亲）','13700009999','A246810','陪同奶盖接种、签署知情同意、缴费取药',now()+interval '30 days')`,
    [id.wangmeili, naigai]);

  const ev = async (caseId, petId, type, authorId, role, title, content, data, visible = true) =>
    q(`INSERT INTO case_events (case_id,pet_id,event_type,author_id,author_role,title,content,data,visible_to_owner)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [caseId, petId, type, authorId, role, title, content, data ? JSON.stringify(data) : null, visible]);

  const makeCase = async (o) =>
    (await q(`INSERT INTO cases (case_no,pet_id,owner_id,case_type,channel,status,appointment_at,doctor_id,
        room_id,batch_id,fasting_hours,preop_required,stress_plan,plan_note,total_fee,fee_paid,
        referral_out_hospital,referral_reason,referral_in_from,check_in_at,identity_verified,auth_verified,fee_verified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING id`,
      [o.no, o.pet, o.owner, o.type, o.channel || 'onsite', o.status, o.appt || null,
       o.doctor || null, o.room || null, o.batch || null, o.fasting ?? 0, !!o.preop,
       o.stressPlan || null, o.planNote || null, o.fee || 0, !!o.paid,
       o.refHospital || null, o.refReason || null, o.refFrom || null,
       o.checkinAt || null, !!o.identity, !!o.authed, !!o.feeVerified])).rows[0].id;
  const caseNo = (n) => `C20260913-${n}`;

  // C1 奶盖 今日疫苗接种（已排计划，待到院核验；父亲可凭 A246810 代办）
  const c1 = await makeCase({ no: caseNo('01'), pet: naigai, owner: id.wangmeili, type: 'vaccine',
    status: 'planned', appt: new Date(), doctor: id.chenaisi, room: 1, batch: bCat3a,
    stressPlan: '高应激：安排1号独立诊室，使用费洛蒙，父亲全程陪同，到院优先叫号', fee: 120 });
  await ev(c1, naigai, 'booking', id.wangmeili, 'owner', '主人预约猫三联第二针', '奶盖第一针后无不良反应，预约第二针');
  await ev(c1, naigai, 'plan', null, 'system', '系统生成到院计划',
    '接种前正常清淡饮食，无需禁食；高应激：安排独立安静诊室，主人全程陪同，减少候诊时间；留观20分钟谨防急性过敏',
    { fasting: 0, preop: false });

  // C2 年糕 公犬去势手术 → 住院中（可演练伤口渗血/发药配合度/回访）
  const c2 = await makeCase({ no: caseNo('02'), pet: niangao, owner: id.lizhiqiang, type: 'surgery',
    status: 'hospitalized', appt: new Date(Date.now() - 86400000), doctor: id.wangdafu, room: 3,
    fasting: 8, preop: true, fee: 1680, paid: true, identity: true, authed: true, feeVerified: true,
    checkinAt: new Date(Date.now() - 86400000),
    stressPlan: '应激低，按常规术后护理流程' });
  await q(`UPDATE cases SET check_in_at=now()-interval '1 day' WHERE id=$1`, [c2]);
  await ev(c2, niangao, 'booking', id.lizhiqiang, 'owner', '预约公犬去势手术', '主人要求同期洗牙评估');
  await ev(c2, niangao, 'plan', null, 'system', '系统生成到院计划',
    '术前禁食8小时、禁水2小时；到院先完成血常规/生化/凝血，结果正常方可麻醉；留观苏醒后转入住院笼位');
  await ev(c2, niangao, 'checkin', id.zhangmin, 'reception', '前台到院核验通过', '身份核验✓ 主人本人到场 ✓ 费用确认✓（预交1680元）');
  await q(`INSERT INTO triages (case_id,nurse_id,temp_c,weight_kg,spirit,suitable,decision,note)
   VALUES ($1,$2,38.6,28.6,'lively',TRUE,'proceed','精神良好，符合麻醉条件')`, [c2, id.huxiaojing]);
  await ev(c2, niangao, 'triage', id.huxiaojing, 'nurse', '护士分诊完成，适合处置', '体温38.6℃，体重28.6kg，精神活泼');
  await q(`INSERT INTO preop_exams (case_id,doctor_id,cbc,biochem,clotting,result,fit_for_anesthesia,note)
   VALUES ($1,$2,'normal','normal','normal','normal',TRUE,'各项指标正常')`, [c2, id.wangdafu]);
  await ev(c2, niangao, 'preop', id.wangdafu, 'doctor', '术前检查正常，可安排麻醉', '血常规/生化/凝血均正常');
  await q(`INSERT INTO surgeries (case_id,pet_id,doctor_id,surgery_name,anesthesia,started_at,finished_at,wound_status,elizabeth_collar,collar_fit,note)
   VALUES ($1,$2,$3,'公犬去势术','吸入麻醉',now()-interval '22 hours',now()-interval '20 hours','ok',TRUE,'L号合适，未挣脱','手术顺利，出血量少')`,
    [c2, niangao, id.wangdafu]);
  await ev(c2, niangao, 'surgery', id.wangdafu, 'doctor', '公犬去势术 手术完成', '吸入麻醉，手术顺利；已佩戴伊丽莎白圈（L号合适）');
  await q(`INSERT INTO medical_orders (case_id,doctor_id,content,revisit_on)
   VALUES ($1,$2,'术后保持伤口干燥，每日碘伏消毒2次，佩戴伊丽莎白圈至拆线；抗生素连用5天',CURRENT_DATE+7)`,
    [c2, id.wangdafu]);
  await q(`INSERT INTO medications (case_id,drug_name,dosage,frequency,days,qty,status,compliance,dispensed_at,pharmacist_id,note)
   VALUES ($1,'头孢氨苄片','500mg','每日2次',5,10,'dispensed','needs_assist',now()-interval '20 hours',$2,'主人反馈狗狗抗拒吃药，建议裹肉丸给药'),
          ($1,'美洛昔康口服液','按体重0.1mg/kg','每日1次',3,1,'dispensed','normal',now()-interval '20 hours',$2,NULL)`,
    [c2, id.liuyao]);
  await ev(c2, niangao, 'order', id.wangdafu, 'doctor', '医生开具医嘱',
    '术后伤口护理+抗生素5天；复诊 拆线复查；处方 头孢氨苄片、美洛昔康口服液');
  await ev(c2, niangao, 'medication', id.liuyao, 'pharmacy', '⚠ 用药不配合，已在病例中标注',
    '头孢氨苄片：需主人辅助喂药（抗拒躲闪），已指导裹肉丸给药并通知医生');
  await q(`INSERT INTO hospitalizations (case_id,pet_id,cage_id,admitted_at,status,wound_check)
   VALUES ($1,$2,(SELECT id FROM cages WHERE code='C03'),now()-interval '20 hours','admitted','ok')`,
    [c2, niangao]);
  await ev(c2, niangao, 'hospitalization', id.huxiaojing, 'nurse', '术后住院，安排笼位 C03', '笼位C03（M号）；一级术后护理，2小时巡查一次');
  await q(`INSERT INTO followups (case_id,pet_id,due_on,channel) VALUES ($1,$2,CURRENT_DATE,'phone')`, [c2, niangao]);
  await q(`INSERT INTO reminders (pet_id,case_id,kind,title,due_on) VALUES ($1,$2,'revisit','年糕 术后7天拆线复查',CURRENT_DATE+7)`,
    [niangao, c2]);

  // C3 咪咪 在线图文问诊（与到院病例同档，演示线上线下合并）
  const c3 = await makeCase({ no: caseNo('03'), pet: mimi, owner: id.lizhiqiang, type: 'online',
    channel: 'online', status: 'in_progress', doctor: id.chenaisi,
    planNote: '老年猫CKD二期，线上呕吐咨询' });
  await ev(c3, mimi, 'consult', id.lizhiqiang, 'owner', '主人线上补充病情',
    '咪咪最近3天每天呕吐2-3次，食欲下降，喝水变多。慢性肾病一直在吃处方粮。');
  await q(`INSERT INTO consultations (case_id,sender_id,sender_role,msg_type,content)
   VALUES ($1,$2,'owner','text','咪咪最近3天每天吐2-3次，没什么精神，粮食也不太吃'),
          ($1,$2,'owner','image','[图片] 呕吐物照片，偏黄绿色液体'),
          ($1,$3,'doctor','text','收到。老年猫+CKD病史，建议今天到院查肾功四项和电解质，排查脱水。线上记录我已并入门诊病例，到院不用再重复描述。'),
          ($1,$2,'owner','text','好的，我们下午过来')`,
    [c3, id.lizhiqiang, id.chenaisi]);
  await ev(c3, mimi, 'photo', id.lizhiqiang, 'owner', '主人上传呕吐物照片', '黄绿色液体，未见毛团');
  await ev(c3, mimi, 'consult', id.chenaisi, 'doctor', '医生线上回复',
    '老年猫+CKD病史，建议到院查肾功四项/电解质，排查脱水与酸中毒');

  // C4 豆豆 犬四联第三针预约（命中缺货批号，演练缺货改约/调剂）
  const c4 = await makeCase({ no: caseNo('04'), pet: doudou, owner: id.wangmeili, type: 'vaccine',
    status: 'planned', appt: new Date(Date.now() + 2 * 86400000), doctor: id.wangdafu, room: 2,
    batch: (await q(`SELECT id FROM vaccine_batches WHERE batch_no='D20260220'`)).rows[0].id,
    stressPlan: '应激低，按常规流程', fee: 110 });
  await ev(c4, doudou, 'booking', id.wangmeili, 'owner', '预约犬四联第三针', '第二针已满21天');
  await ev(c4, doudou, 'plan', null, 'system', '系统生成到院计划', '接种前正常饮食；留观20分钟');
  await ev(c4, doudou, 'remark', id.liuyao, 'pharmacy', '⚠ 疫苗缺货预警',
    '原批号 D20260220 库存清零，新批号 D20260801 已入库可替换，或等3天后采购到货', null, false);

  // C5 年糕 既往体表包块切除（已结案，主人投诉收费）
  const c5 = await makeCase({ no: 'C20260218', pet: niangao, owner: id.lizhiqiang, type: 'surgery',
    status: 'completed', appt: new Date(Date.now() - 30 * 86400000), doctor: id.wangdafu,
    fee: 960, paid: true, identity: true, authed: true, feeVerified: true });
  await q(`INSERT INTO invoices (case_id,item,amount) VALUES
   ($1,'体表包块切除手术费',600),($1,'吸入麻醉费',260),($1,'术前血常规',100)`, [c5]);
  await ev(c5, niangao, 'surgery', id.wangdafu, 'doctor', '背部皮脂腺囊肿切除', '病理送检为良性');
  await q(`INSERT INTO complaints (case_id,owner_id,topic,content,status)
   VALUES ($1,$2,'billing','当时前台口头说麻醉费包含在手术费里，账单却单独收了260元麻醉费，要求核对明细。','open')`,
    [c5, id.lizhiqiang]);
  await ev(c5, niangao, 'complaint', id.lizhiqiang, 'owner', '主人投诉（收费）',
    '当时前台口头说麻醉费包含在手术费里，账单却单独收了260元麻醉费，要求核对明细。');

  // C6 咪咪 跨院转诊
  const c6 = await makeCase({ no: caseNo('06'), pet: mimi, owner: id.lizhiqiang, type: 'followup',
    status: 'referred', appt: new Date(Date.now() - 4 * 86400000), doctor: id.chenaisi,
    refHospital: '市中心宠物医院·影像转诊中心', refReason: '需超声引导下肾穿刺与多普勒肾动脉评估，本院设备不满足',
    identity: true, authed: true, feeVerified: true });
  await ev(c6, mimi, 'referral', id.chenaisi, 'doctor', '跨院转诊至 市中心宠物医院·影像转诊中心',
    '需超声引导下肾穿刺与多普勒肾动脉评估；完整病例（既往化验/线上问诊/处方粮方案）已打包共享');

  // C7 煤球 发热暂缓接种（分诊 contraindicated + 改约）
  const c7 = await makeCase({ no: caseNo('07'), pet: meiqiu, owner: id.lizhiqiang, type: 'vaccine',
    status: 'contraindicated', appt: new Date(Date.now() - 2 * 86400000), doctor: id.chenaisi,
    batch: bCat3Cold, identity: true, authed: true, feeVerified: true });
  await q(`INSERT INTO triages (case_id,nurse_id,temp_c,weight_kg,spirit,suitable,decision,note)
   VALUES ($1,$2,40.1,4.3,'depressed',FALSE,'hold_fever','高热、精神沉郁，建议先排查传染病')`,
    [c7, id.huxiaojing]);
  await ev(c7, meiqiu, 'triage', id.huxiaojing, 'nurse', '分诊发现发热，暂缓接种',
    '体温40.1℃，精神沉郁；已停止接种并请医生评估，与主人约定痊愈后补打');
  await ev(c7, meiqiu, 'remark', id.zhangmin, 'reception', '主人改约', '改约至体温恢复正常3天后，电话随访');
  await ev(c7, meiqiu, 'feedback', id.lizhiqiang, 'owner', '主人反馈：8天前接种冷链异常批号疫苗后萎靡',
    '煤球8天前在本院接种批号 M3202507C 疫苗后曾精神萎靡、食欲下降约24小时；本次发热需结合该情况排查', null, true);

  // C7b 煤球 8天前第二针（冷链异常批号，出现不良反应——供传染病/同批次排查追溯）
  const c7b = await makeCase({ no: 'C20260905-118', pet: meiqiu, owner: id.lizhiqiang, type: 'vaccine',
    status: 'completed', appt: new Date(Date.now() - 8 * 86400000), doctor: id.chenaisi, batch: bCat3Cold,
    fee: 120, paid: true, identity: true, authed: true, feeVerified: true });
  await q(`INSERT INTO vaccinations (case_id,pet_id,batch_id,doctor_id,vaccine_name,dose_no,given_at,adverse)
   VALUES ($1,$2,$3,$4,'妙三多（猫三联）',2,now()-interval '8 days','接种后精神萎靡、食欲下降约24小时后自行恢复')`,
    [c7b, meiqiu, bCat3Cold, id.chenaisi]);
  await ev(c7b, meiqiu, 'vaccination', id.chenaisi, 'doctor', '妙三多（猫三联）第二针（批号 M3202507C）',
    '接种当日留观无急性反应；次日主人电话反馈精神萎靡、食欲下降，约24小时后自行恢复，已登记不良反应',
    { batchNo: 'M3202507C', adverse: true });

  // C8 奶盖 既往狂犬疫苗（已完成，长期档案示例）
  const c8 = await makeCase({ no: 'C2025-1032', pet: naigai, owner: id.wangmeili, type: 'vaccine',
    status: 'completed', appt: new Date(Date.now() - 300 * 86400000), doctor: id.chenaisi, batch: bRab,
    fee: 80, paid: true, identity: true, authed: true, feeVerified: true });
  await q(`INSERT INTO vaccinations (case_id,pet_id,batch_id,doctor_id,vaccine_name,dose_no,given_at)
   VALUES ($1,$2,$3,$4,'瑞比克狂犬疫苗',1,now()-interval '300 days')`, [c8, naigai, bRab, id.chenaisi]);
  await ev(c8, naigai, 'vaccination', id.chenaisi, 'doctor', '瑞比克狂犬疫苗 接种完成',
    '批号 R20260115，接种后留观20分钟无异常');

  // 其余提醒
  await q(`INSERT INTO reminders (pet_id,case_id,kind,title,due_on,status)
   VALUES ($1,NULL,'vaccine','奶盖 妙三多第2针（免疫证记录）',CURRENT_DATE+7,'pending'),
          ($2,NULL,'deworm','年糕 体外驱虫到期',CURRENT_DATE-29,'pending'),
          ($3,NULL,'followup','煤球 发热痊愈后补打疫苗',CURRENT_DATE+1,'pending')`,
    [naigai, niangao, meiqiu]);

  console.log('Seed done. 密码统一：123456');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
