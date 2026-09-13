<template>
  <div class="page">
    <el-card>
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>{{ role==='owner' ? '我的宠物建档' : '宠物档案库' }}</b>
          <div>
            <el-input v-if="role!=='owner'" v-model="kw" placeholder="搜宠物/芯片号/主人" clearable style="width:220px;margin-right:10px" @keyup.enter="load" @clear="load" />
            <el-button v-if="role==='owner'" type="primary" @click="openAdd">＋ 为猫狗建档</el-button>
            <el-button v-if="role==='owner'" @click="showAuth=true;loadAuth()">代办授权管理</el-button>
          </div>
        </div>
      </template>
      <el-table :data="pets" size="small" @row-click="r=>$router.push(`/pets/${r.id}`)" style="cursor:pointer">
        <el-table-column prop="name" label="名字" width="90" />
        <el-table-column label="种类" width="70"><template #default="{row}">{{ SPECIES[row.species] }}</template></el-table-column>
        <el-table-column prop="breed" label="品种" width="180" />
        <el-table-column label="月龄/体重" width="110">
          <template #default="{row}">{{ row.age_months }}月 / {{ row.weight_kg }}kg</template>
        </el-table-column>
        <el-table-column label="绝育" width="70">
          <template #default="{row}"><el-tag size="small" :type="row.neutered?'success':'info'">{{ row.neutered?'已绝育':'未绝育' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="应激" width="120">
          <template #default="{row}"><el-rate :model-value="row.stress_level" disabled size="small" /></template>
        </el-table-column>
        <el-table-column prop="allergies" label="过敏史" show-overflow-tooltip />
        <el-table-column v-if="role!=='owner'" prop="owner_name" label="主人" width="100" />
        <el-table-column v-if="role!=='owner'" prop="owner_phone" label="联系电话" width="130" />
        <el-table-column label="状态" width="90">
          <template #default="{row}">
            <el-tag v-if="row.lost_status==='missing'" type="danger" size="small">走失中</el-tag>
            <el-tag v-else-if="row.lost_status==='found'" type="warning" size="small">已找回</el-tag>
            <span v-else class="muted">正常</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 建档/编辑 -->
    <el-dialog v-model="showForm" :title="form.id?'编辑档案':'为猫狗建档'" width="640px">
      <el-form :model="form" label-width="96px">
        <el-row :gutter="10">
          <el-col :span="12"><el-form-item label="名字"><el-input v-model="form.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="种类">
            <el-radio-group v-model="form.species"><el-radio value="cat">猫</el-radio><el-radio value="dog">狗</el-radio></el-radio-group>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="品种"><el-input v-model="form.breed" placeholder="如 英国短毛猫/柯基" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="性别">
            <el-radio-group v-model="form.gender"><el-radio value="female">母</el-radio><el-radio value="male">公</el-radio></el-radio-group>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="出生日期"><el-date-picker v-model="form.birth_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="月龄"><el-input-number v-model="form.age_months" :min="0" :max="300" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="体重(kg)"><el-input-number v-model="form.weight_kg" :min="0" :precision="2" :step="0.1" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="是否绝育"><el-switch v-model="form.neutered" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="芯片号"><el-input v-model="form.microchip_no" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="过敏史"><el-input v-model="form.allergies" type="textarea" :rows="2" placeholder="药物/食物过敏" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="慢性疾病"><el-input v-model="form.chronic_diseases" type="textarea" :rows="2" placeholder="如 CKD、髌骨脱位等" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="应激程度">
            <el-rate v-model="form.stress_level" show-text :texts="['很淡定','轻微','中等','易应激','极度胆小']" />
          </el-form-item></el-col>
          <el-col :span="24"><el-form-item label="性情备注"><el-input v-model="form.temper_note" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="showForm=false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 代办授权 -->
    <el-dialog v-model="showAuth" title="主人代办授权（家人/朋友凭授权码到场核验）" width="620px">
      <el-form inline>
        <el-form-item label="代办人"><el-input v-model="auth.agentName" placeholder="姓名" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="auth.agentPhone" /></el-form-item>
        <el-form-item label="有效天数"><el-input-number v-model="auth.days" :min="1" :max="90" /></el-form-item>
        <el-button type="primary" @click="createAuth">生成授权码</el-button>
      </el-form>
      <el-table :data="auths" size="small">
        <el-table-column prop="agent_name" label="代办人" width="100" />
        <el-table-column prop="agent_phone" label="电话" width="130" />
        <el-table-column prop="auth_code" label="授权码" width="110">
          <template #default="{row}"><b style="color:#2f7d61;letter-spacing:1px">{{ row.auth_code }}</b></template>
        </el-table-column>
        <el-table-column prop="scope" label="授权范围" show-overflow-tooltip />
        <el-table-column label="有效期" width="110"><template #default="{row}">{{ day(row.valid_until) }}</template></el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{row}"><el-tag size="small" :type="row.revoked?'info':'success'">{{ row.revoked?'已撤销':'有效' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="70">
          <template #default="{row}"><el-button v-if="!row.revoked" link type="danger" @click.stop="revoke(row)">撤销</el-button></template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import api, { SPECIES, day } from '../api.js';
import { ElMessage, ElMessageBox } from 'element-plus';

const role = JSON.parse(localStorage.getItem('user')).role;
const pets = ref([]);
const kw = ref('');
const showForm = ref(false);
const showAuth = ref(false);
const auths = ref([]);
const empty = () => ({ name: '', species: 'cat', breed: '', gender: 'female', birth_date: '', age_months: 12, weight_kg: 3, neutered: false, microchip_no: '', allergies: '', chronic_diseases: '', stress_level: 1, temper_note: '' });
const form = reactive(empty());
const auth = reactive({ agentName: '', agentPhone: '', days: 7 });

async function load() {
  pets.value = (await api.get('/pets', { params: { keyword: kw.value } })).data;
}
function openAdd() { Object.assign(form, empty()); showForm.value = true; }
async function save() {
  if (!form.name || !form.breed) return ElMessage.warning('名字和品种必填');
  await api.post('/pets', form);
  ElMessage.success('档案已保存');
  showForm.value = false;
  load();
}
async function loadAuth() { auths.value = (await api.get('/authorizations')).data; }
async function createAuth() {
  if (!auth.agentName || !auth.agentPhone) return ElMessage.warning('请填写代办人信息');
  await api.post('/authorizations', auth);
  ElMessage.success('授权码已生成，代办人到院时报授权码即可');
  Object.assign(auth, { agentName: '', agentPhone: '', days: 7 });
  loadAuth();
}
async function revoke(row) {
  await ElMessageBox.confirm(`确定撤销给 ${row.agent_name} 的授权？`, '确认', { type: 'warning' });
  await api.post(`/authorizations/${row.id}/revoke`);
  loadAuth();
}
onMounted(load);
</script>
