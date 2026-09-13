<template>
  <div class="page">
    <el-card style="margin-bottom:14px">
      <template #header><b>🔬 传染病 / 同批次疫苗排查（冷链异常或不良反应触发）</b></template>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <el-select v-model="batchId" placeholder="选择风险批号" clearable style="width:360px" @change="loadTrace">
          <el-option v-for="b in riskBatches" :key="b.id"
            :label="`${b.product_name} ${b.batch_no}（${batchCN[b.status]}，已用 ${b.used_count} 支）`" :value="b.id" />
        </el-select>
      </div>
      <el-table :data="traced" size="small" v-if="batchId">
        <el-table-column prop="given_at" label="接种时间" width="160"><template #default="{row}">{{ fmt(row.given_at) }}</template></el-table-column>
        <el-table-column prop="pet_name" label="宠物" width="90" />
        <el-table-column label="种类" width="60"><template #default="{row}">{{ {cat:'猫',dog:'犬'}[row.species] }}</template></el-table-column>
        <el-table-column prop="owner_name" label="主人" width="100" />
        <el-table-column prop="owner_phone" label="联系电话" width="130" />
        <el-table-column prop="case_no" label="病例号" width="150">
          <template #default="{row}"><el-link type="primary" @click="$router.push(`/cases/${row.case_id}`)">{{ row.case_no }}</el-link></template>
        </el-table-column>
        <el-table-column label="不良反应">
          <template #default="{row}">
            <el-tag v-if="row.adverse" type="danger" size="small">{{ row.adverse }}</el-tag>
            <span v-else class="muted">暂无上报</span>
          </template>
        </el-table-column>
      </el-table>
      <el-alert v-if="riskBatches.length===0" type="success" :closable="false" title="当前无风险批号" />
    </el-card>

    <el-card>
      <template #header><b>📊 医院质量复盘（异常事件汇总）</b></template>
      <el-row :gutter="12">
        <el-col :span="12">
          <h4 style="color:#f56c6c">发热/暂缓分诊（{{ q.feverTriages?.length||0 }}）</h4>
          <el-table :data="q.feverTriages||[]" size="small" max-height="220">
            <el-table-column prop="case_no" label="病例" width="130" />
            <el-table-column prop="pet_name" label="宠物" width="80" />
            <el-table-column prop="temp_c" label="体温" width="70" />
            <el-table-column prop="note" label="说明" show-overflow-tooltip />
          </el-table>
        </el-col>
        <el-col :span="12">
          <h4 style="color:#f56c6c">术后伤口问题（{{ q.woundIssues?.length||0 }}）</h4>
          <el-table :data="q.woundIssues||[]" size="small" max-height="220">
            <el-table-column prop="case_no" label="病例" width="130" />
            <el-table-column prop="pet_name" label="宠物" width="80" />
            <el-table-column prop="surgery_name" label="手术" show-overflow-tooltip />
            <el-table-column prop="wound_status" label="伤口" width="80" />
          </el-table>
        </el-col>
        <el-col :span="12" style="margin-top:14px">
          <h4 style="color:#e6a23c">用药配合问题（{{ q.cooperationIssues?.length||0 }}）</h4>
          <el-table :data="q.cooperationIssues||[]" size="small" max-height="220">
            <el-table-column prop="case_no" label="病例" width="130" />
            <el-table-column prop="pet_name" label="宠物" width="80" />
            <el-table-column prop="drug_name" label="药品" width="120" />
            <el-table-column prop="note" label="情况" show-overflow-tooltip />
          </el-table>
        </el-col>
        <el-col :span="12" style="margin-top:14px">
          <h4 style="color:#f56c6c">回访异常（{{ q.abnormalFollowups?.length||0 }}）</h4>
          <el-table :data="q.abnormalFollowups||[]" size="small" max-height="220">
            <el-table-column prop="case_no" label="病例" width="130" />
            <el-table-column prop="pet_name" label="宠物" width="80" />
            <el-table-column prop="abnormal" label="异常反馈" show-overflow-tooltip />
          </el-table>
        </el-col>
        <el-col :span="12" style="margin-top:14px">
          <h4 style="color:#9b59b6">收费/服务投诉（{{ q.complaints?.length||0 }}）</h4>
          <el-table :data="q.complaints||[]" size="small" max-height="220">
            <el-table-column prop="case_no" label="病例" width="130" />
            <el-table-column label="类型" width="80">
              <template #default="{row}">{{ {billing:'收费',service:'服务',quality:'质量',other:'其他'}[row.topic] }}</template>
            </el-table-column>
            <el-table-column prop="content" label="内容" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="90" />
          </el-table>
        </el-col>
        <el-col :span="12" style="margin-top:14px">
          <h4 style="color:#f56c6c">疫苗不良反应（{{ q.adverseReactions?.length||0 }}）</h4>
          <el-table :data="q.adverseReactions||[]" size="small" max-height="220">
            <el-table-column prop="case_no" label="病例" width="130" />
            <el-table-column prop="pet_name" label="宠物" width="80" />
            <el-table-column prop="vaccine_name" label="疫苗" width="150" />
            <el-table-column prop="adverse" label="反应" show-overflow-tooltip />
          </el-table>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import api, { fmt } from '../api.js';

const q = ref({});
const riskBatches = ref([]);
const traced = ref([]);
const batchId = ref(null);
const batchCN = { normal: '正常', shortage: '缺货', expired: '过期', cold_chain_break: '冷链中断', recall: '召回' };

async function loadTrace() {
  if (!batchId.value) return (traced.value = []);
  traced.value = (await api.get('/infection-trace', { params: { batchId: batchId.value } })).data;
}
onMounted(async () => {
  q.value = (await api.get('/quality-review')).data;
  riskBatches.value = (await api.get('/infection-trace')).data;
});
</script>
