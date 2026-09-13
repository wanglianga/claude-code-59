<template>
  <div class="page">
    <el-card>
      <template #header><b>投诉处理（投诉记录挂在对应病例中，前台/主人同档可见）</b></template>
      <el-table :data="list" size="small">
        <el-table-column prop="id" label="#" width="50" />
        <el-table-column prop="case_no" label="关联病例" width="150">
          <template #default="{row}">
            <el-link v-if="row.case_id" type="primary" @click="$router.push(`/cases/${row.case_id}`)">{{ row.case_no }}</el-link>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="pet_name" label="宠物" width="80" />
        <el-table-column prop="owner_name" label="投诉主人" width="100" />
        <el-table-column label="类型" width="90">
          <template #default="{row}">
            <el-tag size="small" :type="row.topic==='billing'?'warning':''">{{ topicCN[row.topic] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="content" label="投诉内容" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{row}"><el-tag size="small" :type="stType[row.status]">{{ stCN[row.status] }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="reply" label="回复" show-overflow-tooltip />
        <el-table-column label="操作" width="150">
          <template #default="{row}">
            <el-button v-if="row.status!=='resolved' && row.status!=='closed'" link type="primary" @click="open(row)">处理/回复</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="show" title="处理投诉" width="480px">
      <el-alert type="info" :closable="false" style="margin-bottom:10px"
        :title="`${cur.topic?topicCN[cur.topic]:''}：${cur.content||''}`" />
      <el-form label-width="80px">
        <el-form-item label="处理状态">
          <el-radio-group v-model="form.status">
            <el-radio value="handling">受理中（核对收费明细）</el-radio>
            <el-radio value="resolved">已解决</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="回复主人"><el-input v-model="form.reply" type="textarea" :rows="4"
          placeholder="说明核对结果/退费方案，回复将写入病例，主人可见" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="show=false">取消</el-button>
        <el-button type="primary" @click="submit">提交处理</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import api from '../api.js';
import { ElMessage } from 'element-plus';

const list = ref([]);
const show = ref(false);
const cur = ref({});
const form = reactive({ status: 'handling', reply: '' });
const topicCN = { billing: '收费', service: '服务', quality: '医疗质量', other: '其他' };
const stCN = { open: '待处理', handling: '处理中', resolved: '已解决', closed: '已关闭' };
const stType = { open: 'danger', handling: 'warning', resolved: 'success', closed: 'info' };

async function load() { list.value = (await api.get('/complaints')).data; }
function open(row) {
  cur.value = row;
  form.status = row.status === 'open' ? 'handling' : row.status;
  form.reply = row.reply || '';
  show.value = true;
}
async function submit() {
  await api.post(`/complaints/${cur.value.id}/handle`, form);
  ElMessage.success('处理结果已同步到病例');
  show.value = false;
  load();
}
onMounted(load);
</script>
