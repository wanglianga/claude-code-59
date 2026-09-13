<template>
  <div class="page">
    <el-card>
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <b>病例总览</b>
          <div>
            <el-select v-model="filters.status" placeholder="状态" clearable style="width:130px" @change="load">
              <el-option v-for="(v,k) in CASE_STATUS" :key="k" :label="v" :value="k" />
            </el-select>
            <el-select v-model="filters.channel" placeholder="渠道" clearable style="width:120px;margin-left:8px" @change="load">
              <el-option label="线上问诊" value="online" />
              <el-option label="到院" value="onsite" />
            </el-select>
            <el-button v-if="role==='nurse'" style="margin-left:8px" @click="nurseOnly=!nurseOnly;load()">{{ nurseOnly?'查看全部':'只看待处理' }}</el-button>
          </div>
        </div>
      </template>
      <el-table :data="cases" size="small" @row-click="r=>$router.push(`/cases/${r.id}`)" style="cursor:pointer">
        <el-table-column prop="case_no" label="病例号" width="150" />
        <el-table-column prop="pet_name" label="宠物" width="90" />
        <el-table-column v-if="role!=='owner'" prop="owner_name" label="主人" width="100" />
        <el-table-column label="类型" width="120">
          <template #default="{row}">
            {{ CASE_TYPE[row.case_type] }}
            <el-tag v-if="row.channel==='online'" size="small" type="primary" effect="plain">线上</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}"><el-tag size="small" :type="STATUS_TYPE[row.status]">{{ CASE_STATUS[row.status] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="时间" width="155"><template #default="{row}">{{ fmt(row.appointment_at) }}</template></el-table-column>
        <el-table-column prop="doctor_name" label="医生" width="100" />
        <el-table-column label="收费" width="90">
          <template #default="{row}">¥{{ row.total_fee }} <el-tag v-if="row.fee_paid" size="small" type="success">已付</el-tag></template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import api, { CASE_STATUS, CASE_TYPE, STATUS_TYPE, fmt } from '../api.js';

const role = JSON.parse(localStorage.getItem('user')).role;
const cases = ref([]);
const nurseOnly = ref(false);
const filters = reactive({ status: '', channel: '' });

async function load() {
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.channel) p.set('channel', filters.channel);
  if (nurseOnly.value) p.set('mine', '1');
  if (role === 'doctor') p.set('mine', '1');
  cases.value = (await api.get('/cases?' + p.toString())).data;
}
onMounted(load);
</script>
