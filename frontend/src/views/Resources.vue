<template>
  <div class="page">
    <el-tabs v-model="tab">
      <!-- 疫苗批号与冷链（药房最常用） -->
      <el-tab-pane name="batch" label="💉 疫苗批号 / 冷链">
        <el-card>
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>疫苗批号库存与冷链状态</b>
              <el-button v-if="canEditVaccine" type="primary" size="small" @click="openBatch">＋ 入库新批号</el-button>
            </div>
          </template>
          <el-table :data="batches" size="small">
            <el-table-column prop="product_name" label="疫苗" width="180" />
            <el-table-column prop="batch_no" label="批号" width="130" />
            <el-table-column label="效期" width="110"><template #default="{row}">{{ day(row.expire_on) }}</template></el-table-column>
            <el-table-column label="库存" width="90">
              <template #default="{row}">
                <b :style="{color: row.qty_available<=0?'#f56c6c':'inherit'}">{{ row.qty_available }}</b> / {{ row.qty_in }}
              </template>
            </el-table-column>
            <el-table-column label="冷链区间" width="110">
              <template #default="{row}">{{ row.storage_temp_lo }}~{{ row.storage_temp_hi }}℃</template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{row}">
                <el-tag size="small" :type="batchTag[row.status]">{{ batchCN[row.status] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="cold_chain_note" label="冷链/缺货说明" show-overflow-tooltip />
            <el-table-column v-if="canEditVaccine" label="操作" width="240">
              <template #default="{row}">
                <el-button link size="small" @click="flag(row,'shortage')">标记缺货</el-button>
                <el-button link size="small" type="warning" @click="flag(row,'cold_chain_break')">冷链中断</el-button>
                <el-button link size="small" type="success" @click="flag(row,'normal')">恢复正常</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-alert type="info" :closable="false" style="margin-top:10px"
            title="被标记为缺货/冷链中断/过期/召回的批号，医生执行接种时系统将直接拦截，需调剂批号或与主人改约。" />
        </el-card>
      </el-tab-pane>

      <!-- 住院笼位 -->
      <el-tab-pane name="cage" label="🏠 住院笼位">
        <el-card>
          <template #header><b>笼位看板</b></template>
          <el-row :gutter="12">
            <el-col v-for="c in cages" :key="c.id" :span="4" style="margin-bottom:12px">
              <el-card shadow="hover" :body-style="{padding:'14px'}"
                :style="{borderLeft: c.status==='occupied'?'4px solid #e6a23c':c.status==='free'?'4px solid #67c23a':'4px solid #909399'}">
                <div style="font-size:16px"><b>{{ c.code }}</b>（{{ c.size }}号）</div>
                <el-tag size="small" :type="c.status==='free'?'success':c.status==='occupied'?'warning':'info'" style="margin:6px 0">
                  {{ cageCN[c.status] }}
                </el-tag>
                <div v-if="c.pet_name" class="muted">住客：{{ c.pet_name }}</div>
                <el-button v-if="c.status!=='free' && canManageCage" link type="primary" size="small"
                  @click="release(c)">腾空/转清洁</el-button>
              </el-card>
            </el-col>
          </el-row>
        </el-card>
      </el-tab-pane>

      <!-- 医生排班 -->
      <el-tab-pane name="schedule" label="📅 医生排班">
        <el-card>
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>近 5 天排班</b>
              <el-button v-if="role==='admin'||role==='reception'" type="primary" size="small" @click="openSched">＋ 新增排班</el-button>
            </div>
          </template>
          <el-table :data="schedules" size="small">
            <el-table-column prop="work_date" label="日期" width="120" />
            <el-table-column prop="doctor_name" label="医生" width="120" />
            <el-table-column label="时段" width="160">
              <template #default="{row}">{{ String(row.start_time).slice(0,5) }} - {{ String(row.end_time).slice(0,5) }}</template>
            </el-table-column>
            <el-table-column prop="slot_minutes" label="号源粒度(分钟)" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 诊室 -->
      <el-tab-pane name="room" label="🚪 诊室">
        <el-card>
          <el-table :data="rooms" size="small">
            <el-table-column prop="name" label="诊室" />
            <el-table-column label="类型" width="140">
              <template #default="{row}">{{ {consult:'普通诊室',surgery:'手术室',observation:'留观室'}[row.room_type] }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新批号入库 -->
    <el-dialog v-model="showBatch" title="疫苗批号入库" width="480px">
      <el-form label-width="92px">
        <el-form-item label="疫苗产品"><el-select v-model="batch.productId" style="width:100%">
          <el-option v-for="p in products" :key="p.id" :label="`${p.name}（${ {cat:'猫',dog:'犬',both:'猫狗通用'}[p.species] }）`" :value="p.id" /></el-select></el-form-item>
        <el-form-item label="批号"><el-input v-model="batch.batchNo" /></el-form-item>
        <el-form-item label="有效期至"><el-date-picker v-model="batch.expireOn" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="入库数量"><el-input-number v-model="batch.qtyIn" :min="1" /></el-form-item>
        <el-form-item label="冷链温区"><el-input-number v-model="batch.tempLo" :min="-10" :max="20" :step="0.5" /> ~
          <el-input-number v-model="batch.tempHi" :min="-10" :max="20" :step="0.5" /> ℃</el-form-item>
      </el-form>
      <template #footer><el-button @click="showBatch=false">取消</el-button>
        <el-button type="primary" @click="saveBatch">入库</el-button></template>
    </el-dialog>

    <!-- 新增排班 -->
    <el-dialog v-model="showSched" title="新增排班" width="420px">
      <el-form label-width="80px">
        <el-form-item label="医生"><el-select v-model="sched.doctorId" style="width:100%">
          <el-option v-for="d in doctors" :key="d.id" :label="d.display_name" :value="d.id" /></el-select></el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="sched.workDate" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="开始"><el-time-picker v-model="sched.startTime" value-format="HH:mm" format="HH:mm" /></el-form-item>
        <el-form-item label="结束"><el-time-picker v-model="sched.endTime" value-format="HH:mm" format="HH:mm" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showSched=false">取消</el-button>
        <el-button type="primary" @click="saveSched">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import api, { day } from '../api.js';
import { ElMessage, ElMessageBox } from 'element-plus';

const role = JSON.parse(localStorage.getItem('user')).role;
const tab = ref(role === 'pharmacy' ? 'batch' : role === 'nurse' ? 'cage' : 'schedule');
const batches = ref([]); const cages = ref([]); const schedules = ref([]); const rooms = ref([]); const products = ref([]); const doctors = ref([]);
const showBatch = ref(false); const showSched = ref(false);
const batchCN = { normal: '正常', shortage: '缺货', expired: '过期', cold_chain_break: '冷链中断', recall: '召回' };
const batchTag = { normal: 'success', shortage: 'danger', expired: 'info', cold_chain_break: 'warning', recall: 'danger' };
const cageCN = { free: '空闲', occupied: '占用', cleaning: '清洁中' };
const canEditVaccine = computed(() => ['pharmacy', 'admin'].includes(role));
const canManageCage = computed(() => ['nurse', 'doctor', 'admin'].includes(role));
const batch = reactive({ productId: null, batchNo: '', expireOn: '', qtyIn: 10, tempLo: 2, tempHi: 8 });
const sched = reactive({ doctorId: null, workDate: '', startTime: '09:00', endTime: '12:00' });

async function load() {
  const [ba, cg, sc, rm, pr, dr] = await Promise.all([
    api.get('/vaccine-batches'), api.get('/cages'), api.get('/schedules'),
    api.get('/rooms'), api.get('/vaccine-products'), api.get('/doctors')]);
  batches.value = ba.data; cages.value = cg.data; schedules.value = sc.data;
  rooms.value = rm.data; products.value = pr.data; doctors.value = dr.data;
}
function openBatch() { Object.assign(batch, { productId: products.value[0]?.id, batchNo: '', expireOn: '', qtyIn: 10, tempLo: 2, tempHi: 8 }); showBatch.value = true; }
async function saveBatch() {
  if (!batch.productId || !batch.batchNo || !batch.expireOn) return ElMessage.warning('请填写完整');
  await api.post('/vaccine-batches', batch);
  ElMessage.success('批号已入库，纳入冷链监控');
  showBatch.value = false; load();
}
async function flag(row, status) {
  let note = null;
  if (status === 'cold_chain_break') {
    const r = await ElMessageBox.prompt('请记录脱温情况（温度/时长）', '冷链异常上报', { inputType: 'textarea' });
    note = r.value;
  }
  await api.post(`/vaccine-batches/${row.id}/flag`, { status, note });
  ElMessage.success('状态已更新，相关接种将被拦截');
  load();
}
async function release(c) {
  await ElMessageBox.confirm(`将笼位 ${c.code} 转为清洁/空闲？`, '确认', { type: 'warning' });
  await api.post(`/cages/${c.id}/release`);
  load();
}
function openSched() { showSched.value = true; }
async function saveSched() {
  if (!sched.doctorId || !sched.workDate) return ElMessage.warning('请填写完整');
  await api.post('/schedules', sched);
  ElMessage.success('排班已保存');
  showSched.value = false; load();
}
onMounted(load);
</script>
