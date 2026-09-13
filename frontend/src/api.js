import axios from 'axios';
import { ElMessage } from 'element-plus';

const api = axios.create({ baseURL: '/api', timeout: 20000 });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.error || err.message || '请求失败';
    if (err.response?.status === 401 && !location.hash.includes('/login')) {
      localStorage.clear();
      location.hash = '#/login';
    }
    ElMessage.error(msg);
    return Promise.reject(err);
  }
);

export default api;

export const CASE_STATUS = {
  booked: '待接诊', planned: '待到院', arrived: '已到院', triaged: '已分诊',
  contraindicated: '暂缓处置', in_progress: '处置中', hospitalized: '住院中',
  completed: '已完成', discharged: '已出院', rescheduled: '已改约',
  cancelled: '已取消', referred: '已转诊', closed: '已关闭',
};
export const CASE_TYPE = { vaccine: '疫苗接种', surgery: '手术', online: '在线问诊', followup: '复诊/回访' };
export const ROLE = {
  owner: '宠物主人', reception: '前台', doctor: '医生',
  nurse: '护士', pharmacy: '药房', admin: '管理员',
};
export const SPECIES = { cat: '猫', dog: '犬' };

export const STATUS_TYPE = {
  booked: 'info', planned: 'warning', arrived: 'primary', triaged: 'primary',
  contraindicated: 'danger', in_progress: 'warning', hospitalized: 'warning',
  completed: 'success', discharged: 'success', rescheduled: 'info',
  cancelled: 'info', referred: '', closed: 'info',
};

export const EVENT_META = {
  booking: ['预约登记', '#409eff', 'Calendar'],
  plan: ['到院计划', '#909399', 'Tickets'],
  checkin: ['前台核验', '#409eff', 'CircleCheck'],
  triage: ['护士分诊', '#e6a23c', 'FirstAidKit'],
  preop: ['术前检查', '#e6a23c', 'DataAnalysis'],
  vaccination: ['疫苗接种', '#67c23a', 'Syringe'],
  surgery: ['手术记录', '#f56c6c', 'Scalpel'],
  order: ['医嘱处方', '#2f7d61', 'Document'],
  medication: ['药房发药', '#9b59b6', 'Box'],
  photo: ['照片记录', '#16a085', 'Picture'],
  followup: ['回访', '#67c23a', 'Phone'],
  feedback: ['异常反馈', '#f56c6c', 'Warning'],
  consult: ['图文问诊', '#409eff', 'ChatDotRound'],
  referral: ['转诊', '#9b59b6', 'Switch'],
  lost: ['走失预警', '#f56c6c', 'WarningFilled'],
  complaint: ['投诉', '#f56c6c', 'Comment'],
  hospitalization: ['住院管理', '#e6a23c', 'House'],
  billing: ['收费', '#909399', 'Money'],
  remark: ['协作备注', '#909399', 'Notebook'],
};

export function fmt(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
export function day(d) { return d ? String(d).slice(0, 10) : '—'; }
