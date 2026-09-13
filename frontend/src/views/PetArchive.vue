<template>
  <div class="page" v-if="data">
    <el-page-header @back="$router.back()" style="margin-bottom:14px">
      <template #content>
        <b style="font-size:16px">{{ data.pet.name }} 的长期档案</b>
        <el-tag size="small" style="margin-left:8px">{{ SPECIES[data.pet.species] }} · {{ data.pet.breed }}</el-tag>
        <el-tag v-if="data.pet.lost_status==='missing'" type="danger" size="small" style="margin-left:6px">⚠ 走失中</el-tag>
      </template>
    </el-page-header>

    <el-row :gutter="14">
      <el-col :span="8">
        <el-card>
          <template #header><b>基础信息</b></template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="主人">{{ data.pet.owner_name }}（{{ data.pet.owner_phone }}）</el-descriptions-item>
            <el-descriptions-item label="性别">{{ data.pet.gender==='female'?'母':'公' }}</el-descriptions-item>
            <el-descriptions-item label="出生日期 / 月龄">{{ day(data.pet.birth_date) }} / {{ data.pet.age_months }}月</el-descriptions-item>
            <el-descriptions-item label="体重">{{ data.pet.weight_kg }} kg</el-descriptions-item>
            <el-descriptions-item label="绝育">{{ data.pet.neutered?'已绝育 ✓':'未绝育' }}</el-descriptions-item>
            <el-descriptions-item label="芯片号">{{ data.pet.microchip_no||'—' }}</el-descriptions-item>
            <el-descriptions-item label="过敏史"><span style="color:#f56c6c">{{ data.pet.allergies||'无' }}</span></el-descriptions-item>
            <el-descriptions-item label="慢性疾病">{{ data.pet.chronic_diseases||'无' }}</el-descriptions-item>
            <el-descriptions-item label="应激程度">
              <el-rate :model-value="data.pet.stress_level" disabled size="small" />
            </el-descriptions-item>
            <el-descriptions-item label="性情">{{ data.pet.temper_note||'—' }}</el-descriptions-item>
          </el-descriptions>
          <div v-if="data.pet.lost_status==='missing'" style="margin-top:10px">
            <el-alert type="error" :closable="false" :title="`走失：${data.pet.lost_note||''}`" />
            <el-button v-if="role!=='owner' || isOwner" style="margin-top:8px" type="warning" @click="found">登记找回</el-button>
          </div>
          <el-button v-else-if="isOwner" style="margin-top:10px" type="danger" plain @click="markLost">登记宠物走失</el-button>
        </el-card>

        <el-card style="margin-top:14px">
          <template #header><b>💉 既往疫苗</b></template>
          <el-timeline>
            <el-timeline-item v-for="v in data.vaccines" :key="v.id" :timestamp="day(v.vaccinated_on)" placement="top" color="#67c23a">
              <b>{{ v.vaccine_name }}</b>（第{{ v.dose_no }}针）
              <div class="muted">批号 {{ v.batch_no||'—' }} · {{ v.hospital||'' }} {{ v.next_due_on?` · 下次 ${day(v.next_due_on)}`:'' }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-divider>驱虫</el-divider>
          <el-timeline>
            <el-timeline-item v-for="d in data.dewormings" :key="d.id" :timestamp="day(d.dewormed_on)" color="#409eff">
              {{ d.product }}（{{ {internal:'体内',external:'体外',both:'体内外'}[d.kind] }}）
              <span v-if="d.next_due_on" class="muted"> · 下次 {{ day(d.next_due_on) }}</span>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>

      <el-col :span="16">
        <el-card>
          <template #header>
            <div style="display:flex;justify-content:space-between">
              <b>🔔 下一针 / 复诊提醒</b>
            </div>
          </template>
          <el-table :data="data.reminders" size="small">
            <el-table-column prop="due_on" label="到期日" width="120"><template #default="{row}">{{ day(row.due_on) }}</template></el-table-column>
            <el-table-column label="类型" width="80">
              <template #default="{row}">{{ {vaccine:'疫苗',revisit:'复诊',deworm:'驱虫',followup:'回访'}[row.kind] }}</template>
            </el-table-column>
            <el-table-column prop="title" label="提醒" />
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="row.status==='done'?'success':'warning'">{{ {pending:'待处理',sent:'已通知',done:'已完成',snoozed:'已延后'}[row.status] }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card style="margin-top:14px">
          <template #header><b>📒 长期病例时间线（接种/手术/问诊/回访/异常全部归档于此）</b></template>
          <el-timeline>
            <el-timeline-item v-for="e in data.events" :key="e.id" :timestamp="`${fmt(e.created_at)} · ${e.author_name||({system:'系统'}[e.author_role])||'—'}`"
                              placement="top" :color="(EVENT_META[e.event_type]||['','#909399'])[1]">
              <el-popover v-if="e.data && e.data.imageUrl" placement="right" :width="320" trigger="hover">
                <template #reference>
                  <b style="cursor:pointer">📷 {{ e.title }}</b>
                </template>
                <img :src="e.data.imageUrl" style="max-width:100%" />
              </el-popover>
              <b v-else>{{ (EVENT_META[e.event_type]||[e.event_type])[0] }} · {{ e.title }}</b>
              <div style="color:#5b6b63">{{ e.content }}</div>
            </el-timeline-item>
          </el-timeline>
          <div v-if="!data.events.length" class="muted">暂无记录</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api, { SPECIES, EVENT_META, fmt, day } from '../api.js';
import { ElMessage, ElMessageBox } from 'element-plus';

const route = useRoute();
const data = ref(null);
const user = JSON.parse(localStorage.getItem('user'));
const role = user.role;
const isOwner = computed(() => data.value && data.value.pet.owner_id === user.id);

async function load() {
  data.value = (await api.get(`/pets/${route.params.id}/archive`)).data;
}
async function markLost() {
  const { value } = await ElMessageBox.prompt('请描述走失时间、地点等信息', '登记宠物走失', {
    confirmButtonText: '全院协助留意', inputType: 'textarea' });
  await api.post(`/pets/${route.params.id}/lost`, { note: value });
  ElMessage.success('走失预警已通知在院医护，并写入相关病例');
  load();
}
async function found() {
  await api.post(`/pets/${route.params.id}/found`);
  ElMessage.success('已登记找回');
  load();
}
onMounted(load);
</script>
