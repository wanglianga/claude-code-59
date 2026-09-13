<template>
  <div class="page">
    <h3 style="margin:2px 0 16px">你好，{{ user.displayName }} <span class="muted">（{{ roleName }}）</span></h3>

    <!-- 主人看板 -->
    <template v-if="role==='owner'">
      <el-row :gutter="14">
        <el-col :span="6"><el-statistic title="我的宠物" :value="stats.myPets||0" /></el-col>
        <el-col :span="6"><el-statistic title="进行中病例" :value="stats.myCases||0" /></el-col>
        <el-col :span="6"><el-statistic title="待处理提醒" :value="(stats.reminders||[]).length" /></el-col>
      </el-row>
      <el-card style="margin-top:16px">
        <template #header><b>🔔 下一针 / 复诊 / 驱虫提醒</b></template>
        <el-table :data="stats.reminders||[]" size="small">
          <el-table-column prop="due_on" label="日期" width="120"><template #default="{row}">{{ day(row.due_on) }}</template></el-table-column>
          <el-table-column prop="kind" label="类型" width="90">
            <template #default="{row}">{{ {vaccine:'疫苗',revisit:'复诊',deworm:'驱虫',followup:'回访'}[row.kind] }}</template>
          </el-table-column>
          <el-table-column prop="title" label="内容" />
          <el-table-column label="操作" width="120">
            <template #default="{row}">
              <el-button link type="primary" @click="$router.push(`/pets/${row.pet_id}`)">查看档案</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!(stats.reminders||[]).length" class="muted">暂无待办提醒</div>
      </el-card>
    </template>

    <!-- 员工看板 -->
    <template v-else>
      <el-row :gutter="14">
        <el-col v-for="(v,k) in cards" :key="k" :span="6" style="margin-bottom:14px">
          <el-card shadow="hover" :body-style="{padding:'16px'}" style="cursor:pointer" @click="go(k)">
            <div class="muted">{{ v.label }}</div>
            <div style="font-size:30px;font-weight:700" :style="{color:v.danger?'#f56c6c':'#2f7d61'}">{{ v.value }}</div>
          </el-card>
        </el-col>
      </el-row>
      <el-alert v-if="role==='reception'" type="info" :closable="false" style="margin-top:6px"
        title="提示：今日预约到院后，先核验宠物身份（芯片号）→ 主人本人或代办授权码 → 费用确认，再流转给护士分诊。" />
      <el-alert v-if="role==='doctor'" type="info" :closable="false" style="margin-top:6px"
        title="提示：在线问诊与到院病历同档；接种前核对疫苗批号状态（缺货/冷链异常将被系统拦截）。" />
      <el-alert v-if="role==='nurse'" type="info" :closable="false" style="margin-top:6px"
        title="提示：体温≥39.5℃ 自动判为发热暂缓；住院巡查发现伤口渗血会同步通知主管医生。" />
      <el-alert v-if="role==='pharmacy'" type="info" :closable="false" style="margin-top:6px"
        title="提示：冷链中断/召回/过期批号禁止发出；主人喂药不配合请在发药时标注，病例内自动通知医生。" />
    </template>

    <el-card style="margin-top:16px">
      <template #header><div style="display:flex;justify-content:space-between;align-items:center">
        <b>📂 {{ role==='owner' ? '我的病例' : '在院病例动态' }}</b>
        <el-button v-if="role==='owner'" type="primary" size="small" @click="showBook=true">＋ 预约 / 在线问诊</el-button>
      </div></template>
      <el-table :data="cases" size="small" @row-click="(r)=>$router.push(`/cases/${r.id}`)" style="cursor:pointer">
        <el-table-column prop="case_no" label="病例号" width="150" />
        <el-table-column prop="pet_name" label="宠物" width="90" />
        <el-table-column v-if="role!=='owner'" prop="owner_name" label="主人" width="100" />
        <el-table-column label="类型" width="100">
          <template #default="{row}">{{ CASE_TYPE[row.case_type] }}<span v-if="row.channel==='online'" class="muted"> ·线上</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}"><el-tag size="small" :type="STATUS_TYPE[row.status]">{{ CASE_STATUS[row.status] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="预约/发起时间" width="160"><template #default="{row}">{{ fmt(row.appointment_at) }}</template></el-table-column>
        <el-table-column prop="doctor_name" label="医生" width="100" />
      </el-table>
    </el-card>

    <!-- 主人发起预约/问诊 -->
    <el-dialog v-model="showBook" title="预约疫苗/手术 或 在线问诊" width="520px">
      <el-form label-width="92px">
        <el-form-item label="宠物"><el-select v-model="book.petId" placeholder="选择宠物" style="width:100%">
          <el-option v-for="p in pets" :key="p.id" :label="`${p.name}（${SPECIES[p.species]}·${p.breed}）`" :value="p.id" />
        </el-select></el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="book.caseType">
            <el-radio value="vaccine">疫苗接种</el-radio>
            <el-radio value="surgery">手术</el-radio>
            <el-radio value="online">在线图文问诊</el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="book.caseType!=='online'">
          <el-form-item label="到院时间"><el-date-picker v-model="book.appointmentAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width:100%" /></el-form-item>
          <el-form-item label="期望医生">
            <el-select v-model="book.doctorId" clearable style="width:100%">
              <el-option v-for="d in doctors" :key="d.id" :label="`${d.display_name}（${d.title}）`" :value="d.id" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item label="病情说明">
          <el-input v-model="book.note" type="textarea" :rows="3" :placeholder="book.caseType==='online'?'描述症状，可附图片（病例内继续发送）':'备注'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showBook=false">取消</el-button>
        <el-button type="primary" @click="submitBook">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { CASE_STATUS, CASE_TYPE, STATUS_TYPE, SPECIES, ROLE, fmt, day } from '../api.js';
import { ElMessage } from 'element-plus';

const router = useRouter();
const user = JSON.parse(localStorage.getItem('user'));
const role = user.role;
const roleName = ROLE[role];
const stats = ref({});
const cases = ref([]);
const pets = ref([]);
const doctors = ref([]);
const showBook = ref(false);
const book = reactive({ petId: null, caseType: 'vaccine', appointmentAt: null, doctorId: null, note: '' });

const cardMap = {
  reception: [['bookedToday', '今日预约'], ['todayArrivals', '今日已到院'], ['openComplaints', '待处理投诉']],
  doctor: [['myToday', '我的今日病例'], ['awaitTriage', '待到诊/已到院'], ['onlineWaiting', '待回复线上问诊']],
  nurse: [['awaitTriage', '待分诊'], ['hospitalized', '住院中'], ['followupsDue', '待回访']],
  pharmacy: [['pendingMeds', '待发药处方'], ['coopIssues', '用药配合问题'], ['shortage', '冷链/缺货预警']],
  admin: [['totalPets', '在档宠物'], ['hospitalized', '住院中'], ['openComplaints', '未结投诉'], ['coldChainAlerts', '冷链/批号预警']],
};
const cards = computed(() => {
  const out = {};
  for (const [k, label] of (cardMap[role] || [])) out[k] = { label, value: stats.value[k] ?? 0, danger: k.includes('Complaint') || k.includes('shortage') || k.includes('Alerts') };
  return out;
});
function go(k) {
  if (k === 'openComplaints') return router.push('/complaints');
  if (k === 'coldChainAlerts' || k === 'shortage' || k === 'pendingMeds' || k === 'coopIssues') return router.push('/resources');
  if (k === 'followupsDue') return router.push('/cases');
  router.push('/cases');
}

async function load() {
  stats.value = (await api.get('/dashboard')).data;
  const q = role === 'doctor' ? '?mine=1' : role === 'nurse' ? '?mine=1' : '';
  cases.value = (await api.get('/cases' + q)).data;
  if (role === 'owner') pets.value = (await api.get('/pets')).data;
  doctors.value = (await api.get('/doctors')).data;
}
async function submitBook() {
  if (!book.petId) return ElMessage.warning('请选择宠物');
  if (book.caseType !== 'online' && !book.appointmentAt) return ElMessage.warning('请选择到院时间');
  const { data } = await api.post('/cases', book);
  ElMessage.success(book.caseType === 'online' ? '问诊已发起，医生将在病例中回复' : '预约成功，系统已生成到院计划');
  showBook.value = false;
  await load();
  if (data.id) router.push(`/cases/${data.id}`);
}
onMounted(load);
</script>
