import { q, tx } from './db.js';

/** 追加统一病例时间线事件 */
export async function addEvent(client, { caseId, petId, type, authorId, authorRole, title, content, data, visible = true }) {
  const c = client || { query: q };
  await c.query(
    `INSERT INTO case_events (case_id, pet_id, event_type, author_id, author_role, title, content, data, visible_to_owner)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [caseId, petId, type, authorId || null, authorRole || null, title || null, content || null,
     data ? JSON.stringify(data) : null, visible]
  );
}

/** 自动到院计划：禁食 / 术前检查 / 应激安抚 */
export function buildArrivalPlan({ caseType, stressLevel }) {
  const plan = [];
  if (caseType === 'surgery') {
    plan.push('术前禁食 8 小时、禁水 2 小时');
    plan.push('到院先完成血常规/生化/凝血术前检查，结果正常方可麻醉');
  } else {
    plan.push('接种前正常清淡饮食，无需禁食');
  }
  if ((stressLevel || 1) >= 4) {
    plan.push('高应激：安排独立安静诊室，使用费洛蒙安抚，主人全程陪同，减少候诊时间');
  } else if ((stressLevel || 1) >= 3) {
    plan.push('中等应激：优先叫号，护士提前接触安抚，必要时使用安抚包');
  } else {
    plan.push('应激反应低，按常规流程就诊');
  }
  if (caseType === 'vaccine') plan.push('留观 20 分钟，谨防急性过敏');
  return plan.join('；');
}

export const CN = {
  vaccine: '疫苗接种', surgery: '手术', online: '在线问诊', followup: '复诊回访',
};

export async function logCaseEvent(client, caseId, type, title, content, extra = {}) {
  const { rows } = await client.query('SELECT pet_id FROM cases WHERE id=$1', [caseId]);
  await addEvent(client, { caseId, petId: rows[0].pet_id, type, title, content, ...extra });
}
