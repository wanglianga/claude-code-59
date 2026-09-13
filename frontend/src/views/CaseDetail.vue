<template>
  <div class="page" v-if="d">
    <el-page-header @back="$router.back()" style="margin-bottom:12px" />

    <el-row :gutter="14">
      <!-- 左：病例主体 -->
      <el-col :span="17">
        <el-card style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <el-tag size="small">{{ CASE_TYPE[d.case.case_type] }}</el-tag>
              <el-tag v-if="d.case.channel==='online'" size="small" type="primary" effect="plain" style="margin-left:4px">线上渠道</el-tag>
              <b style="font-size:17px;margin-left:6px;cursor:pointer;color:#2f7d61" @click="$router.push(`/pets/${d.case.pet_id}`)">{{ d.case.pet_name }}</b>
              <span class="muted" style="margin-left:8px">病例号 {{ d.case.case_no }}</span>
              <el-tag size="small" :type="STATUS_TYPE[d.case.status]" style="margin-left:8px">{{ CASE_STATUS[d.case.status] }}</el-tag>
            </div>
            <div class="muted">
              主人 {{ d.case.owner_name }} {{ d.case.owner_phone }}
              <span v-if="d.case.doctor_name"> · 医生 {{ d.case.doctor_name }}</span>
            </div>
          </div>
          <el-alert v-if="d.case.plan_note || d.case.stress_plan" type="success" :closable="false" style="margin-top:10px"
            :title="d.case.stress_plan || d.case.plan_note" />
        </el-card>

        <!-- 图文问诊（线上病例或主人可见） -->
        <el-card style="margin-bottom:14px">
          <template #header><b>💬 图文问诊（与到院记录同档，医生无需重复询问）</b></template>
          <div class="chat-box" ref="chatRef">
            <div v-if="!d.consultations.length" class="muted">暂无问诊消息</div>
            <div v-for="m in d.consultations" :key="m.id" class="chat-msg" :class="m.sender_role==='owner'?'owner':'staff'">
              <span class="who">{{ m.sender_name }}</span>
              <div class="bubble">{{ m.content }}</div>
            </div>
          </div>
          <div v-if="canChat" style="margin-top:10px;display:flex;gap:8px">
            <el-input v-model="chatText" type="textarea" :rows="2" :placeholder="role==='owner'?'描述病情/用药反应，可附带图片':'医生回复…'" @keyup.ctrl.enter="sendMsg" />
            <div style="display:flex;flex-direction:column;gap:6px">
              <el-upload :show-file-list="false" :before-upload="sendImage" accept="image/*">
                <el-button>📷 图片</el-button>
              </el-upload>
              <el-button type="primary" @click="sendMsg">发送</el-button>
            </div>
          </div>
        </el-card>

        <!-- 统一时间线 -->
        <el-card>
          <template #header><b>📒 统一病例时间线（前台 / 医生 / 护士 / 药房 / 主人）</b></template>
          <el-timeline>
            <el-timeline-item v-for="e in d.events" :key="e.id"
              :timestamp="`${fmt(e.created_at)} · ${e.author_name||roleCN[e.author_role]||'系统'}`"
              placement="top" :color="(EVENT_META[e.event_type]||['','#909399'])[1]">
              <el-popover v-if="e.data && e.data.imageUrl" placement="right" :width="340" trigger="hover">
                <template #reference><b style="cursor:pointer">📷 {{ e.title }}</b></template>
                <img :src="e.data.imageUrl" style="max-width:100%" />
              </el-popover>
              <b v-else>{{ (EVENT_META[e.event_type]||[e.event_type])[0] }} · {{ e.title }}</b>
              <div style="color:#5b6b63">{{ e.content }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>

      <!-- 右：计划 + 角色操作 + 处置记录 -->
      <el-col :span="7">
        <!-- 到院计划 -->
        <el-card style="margin-bottom:14px" v-if="d.case.channel==='onsite'">
          <template #header><b>🏥 到院计划</b></template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="预约时间">{{ fmt(d.case.appointment_at) }}</el-descriptions-item>
            <el-descriptions-item label="医生">{{ d.case.doctor_name||'待定' }}</el-descriptions-item>
            <el-descriptions-item label="诊室">{{ d.case.room_name||'待定' }}</el-descriptions-item>
            <el-descriptions-item v-if="d.case.case_type==='vaccine'" label="疫苗批号">
              <el-tag size="small" :type="batchTagType">{{ d.case.batch_no||'未锁定' }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="禁食">
              <el-tag v-if="d.case.fasting_hours>0" type="warning" size="small">术前禁食 {{ d.case.fasting_hours }} 小时</el-tag>
              <span v-else>无需禁食</span>
            </el-descriptions-item>
            <el-descriptions-item label="术前检查">
              <el-tag size="small" :type="d.case.preop_required?'warning':'info'">{{ d.case.preop_required?'必须（血常规/生化/凝血）':'不需要' }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="身份核验">
              <el-tag size="small" :type="d.case.identity_verified?'success':'info'">{{ d.case.identity_verified?'已核验':'未核验' }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="代办授权">
              <span v-if="d.authorization">
                <el-tag size="small" type="success">授权码 {{ d.authorization.auth_code }}</el-tag>
                <div class="muted">{{ d.authorization.agent_name }} {{ d.authorization.agent_phone }}</div>
              </span>
              <span v-else-if="d.case.auth_verified" class="muted">主人本人到场</span>
              <span v-else class="muted">未核验</span>
            </el-descriptions-item>
            <el-descriptions-item label="费用">¥{{ d.case.total_fee }}
              <el-tag size="small" :type="d.case.fee_paid?'success':'danger'">{{ d.case.fee_paid?'已结清':'待支付' }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 角色操作 -->
        <el-card style="margin-bottom:14px">
          <template #header><b>⚙️ 我的操作（{{ roleCN[role] }}）</b></template>
          <div style="display:flex;flex-direction:column;gap:8px">
            <template v-if="role==='reception'">
              <el-button v-if="['planned'].includes(st)" type="primary" @click="dlg.checkin=true">到院核验（身份/授权/费用）</el-button>
              <el-button @click="dlg.plan=true">调整到院计划</el-button>
              <el-button @click="dlg.reschedule=true">主人临时改约</el-button>
              <el-button @click="dlg.billing=true">收费登记</el-button>
            </template>
            <template v-if="role==='nurse'">
              <el-button v-if="['arrived'].includes(st)" type="primary" @click="dlg.triage=true">护士分诊（体温/体重/精神）</el-button>
              <el-button v-if="st==='in_progress'" type="warning" @click="dlg.hospitalize=true">安排住院笼位</el-button>
              <el-button v-if="st==='hospitalized'" @click="dlg.wound=true">术后伤口/伊丽莎白圈巡查</el-button>
              <el-button v-if="st==='hospitalized'" type="success" @click="dlg.discharge=true">康复出院</el-button>
              <el-button @click="dlg.followupPlan=true">安排回访</el-button>
              <el-button type="primary" plain @click="dlg.followup=true">登记回访结果</el-button>
            </template>
            <template v-if="role==='doctor'">
              <el-button v-if="st==='arrived'" @click="dlg.triage=true">代分诊</el-button>
              <el-button v-if="d.case.case_type==='surgery' && st==='triaged'" type="warning" @click="dlg.preop=true">术前检查结论</el-button>
              <el-button v-if="d.case.case_type==='vaccine' && ['triaged'].includes(st)" type="primary" @click="dlg.vaccinate=true">执行接种</el-button>
              <el-button v-if="d.case.case_type==='surgery' && st==='triaged'" type="danger" @click="dlg.surgery=true">手术记录</el-button>
              <el-button v-if="['triaged','in_progress','hospitalized','discharged'].includes(st)" @click="dlg.orders=true">医嘱 + 处方</el-button>
              <el-button v-if="d.case.channel==='online'" @click="dlg.toOnsite=true">转为到院检查</el-button>
              <el-button @click="dlg.refer=true">跨院转诊</el-button>
            </template>
            <template v-if="role==='pharmacy'">
              <el-tag v-if="!d.medications.some(m=>m.status==='prescribed')" type="info" size="small">暂无待发药处方</el-tag>
              <el-button v-for="m in d.medications.filter(x=>x.status==='prescribed')" :key="m.id" type="primary" @click="openDispense(m)">
                发药：{{ m.drug_name }} ×{{ m.qty }}
              </el-button>
            </template>
            <template v-if="role==='owner'">
              <el-button v-if="d.case.channel==='onsite'" @click="dlg.reschedule=true">申请改约</el-button>
              <el-button @click="dlg.photo=true">📷 上传术后/病情照片</el-button>
              <el-button type="danger" plain @click="dlg.complaint=true">投诉（收费等）</el-button>
            </template>
            <el-button v-if="role==='admin'" @click="dlg.plan=true">管理计划（管理员）</el-button>
            <div v-if="role==='doctor'" class="muted" style="font-size:12px">
              接种将强校验：缺货 / 冷链中断 / 过期 / 召回批号系统直接拦截
            </div>
          </div>
        </el-card>

        <!-- 处置记录 -->
        <el-card>
          <el-tabs v-model="tab">
            <el-tab-pane name="triage" label="分诊">
              <div v-for="t in d.triages" :key="t.id" class="rec">
                <el-tag size="small" :type="t.suitable?'success':'danger'">{{ t.suitable?'适合处置':'暂缓' }}</el-tag>
                体温 {{ t.temp_c }}℃ / {{ t.weight_kg }}kg / 精神 {{ spiritCN[t.spirit] }}
                <div class="muted">{{ t.note }} · {{ fmt(t.created_at) }}</div>
              </div>
              <div v-if="!d.triages.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane name="preop" label="术前检查">
              <div v-for="p in d.preops" :key="p.id" class="rec">
                <el-tag size="small" :type="p.result==='normal'?'success':'danger'">{{ p.result==='normal'?'正常':'异常' }}</el-tag>
                血常规 {{ p.cbc }} / 生化 {{ p.biochem }} / 凝血 {{ p.clotting }}
                <div class="muted">{{ p.note }}</div>
              </div>
              <div v-if="!d.preops.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane name="vac" label="接种">
              <div v-for="v in d.vaccinations" :key="v.id" class="rec">
                <b>{{ v.vaccine_name }}</b> 第{{ v.dose_no }}针
                <div class="muted">批号 {{ batchNo(v.batch_id) }} · {{ fmt(v.given_at) }} {{ v.next_due_on?` · 下一针 ${day(v.next_due_on)}`:'' }}</div>
                <el-alert v-if="v.adverse" type="warning" :title="'不良反应：'+v.adverse" :closable="false" />
              </div>
              <div v-if="!d.vaccinations.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane name="surg" label="手术/住院">
              <div v-for="s in d.surgeries" :key="s.id" class="rec">
                <b>{{ s.surgery_name }}</b>
                <el-tag size="small" :type="s.wound_status==='ok'?'success':'danger'">{{ woundCN[s.wound_status] }}</el-tag>
                <div class="muted">{{ s.anesthesia }} · 伊丽莎白圈 {{ s.elizabeth_collar?'已佩戴':'未佩戴' }}（{{ s.collar_fit }}）</div>
              </div>
              <el-divider style="margin:8px 0" />
              <div v-for="h in d.hospitalizations" :key="h.id" class="rec">
                笼位 <b>{{ h.cage_code }}</b>
                <el-tag size="small" :type="h.status==='admitted'?'warning':'success'">{{ h.status==='admitted'?'住院中':'已出院' }}</el-tag>
                <div class="muted">{{ fmt(h.admitted_at) }} → {{ fmt(h.discharged_at) }} {{ h.wound_check?` · ${h.wound_check}`:'' }}</div>
              </div>
              <div v-if="!d.surgeries.length && !d.hospitalizations.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane name="med" label="医嘱/发药">
              <div v-for="o in d.orders" :key="o.id" class="rec">
                📋 {{ o.content }}
                <div class="muted">复诊 {{ day(o.revisit_on) }}</div>
              </div>
              <el-divider style="margin:8px 0" />
              <div v-for="m in d.medications" :key="m.id" class="rec">
                <b>{{ m.drug_name }}</b> {{ m.dosage }} {{ m.frequency }} ×{{ m.days }}天
                <el-tag size="small" :type="medTagType(m)">{{ medStatusCN[m.status] }}{{ m.compliance!=='normal'?'·'+compCN[m.compliance]:'' }}</el-tag>
                <div v-if="m.note" class="muted">{{ m.note }}</div>
              </div>
              <div v-if="!d.orders.length && !d.medications.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane name="fu" label="回访">
              <div v-for="f in d.followups" :key="f.id" class="rec">
                <el-tag size="small" :type="fuType(f.result)">{{ f.result?fuCN[f.result]:'待回访' }}</el-tag>
                {{ day(f.due_on) }} · {{ {phone:'电话',wechat:'微信',onsite:'到院'}[f.channel] }}
                <div v-if="f.abnormal" class="muted">{{ f.abnormal }}</div>
              </div>
              <div v-if="!d.followups.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane name="bill" label="收费">
              <div v-for="i in d.invoices" :key="i.id" class="rec">{{ i.item }} <b>¥{{ i.amount }}</b></div>
              <div v-if="!d.invoices.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane v-if="d.complaints.length || role==='reception'" name="cp" label="投诉">
              <div v-for="c in d.complaints" :key="c.id" class="rec">
                <el-tag size="small" :type="c.status==='resolved'?'success':'danger'">{{ {open:'待处理',handling:'处理中',resolved:'已解决',closed:'已关闭'}[c.status] }}</el-tag>
                {{ {billing:'收费',service:'服务',quality:'医疗质量',other:'其他'}[c.topic] }}
                <div>{{ c.content }}</div>
                <div v-if="c.reply" class="muted">回复：{{ c.reply }}</div>
              </div>
              <div v-if="!d.complaints.length" class="muted">暂无</div>
            </el-tab-pane>
            <el-tab-pane v-if="d.case.referral_out_hospital" name="ref" label="转诊">
              <div class="rec">
                转至 <b>{{ d.case.referral_out_hospital }}</b>
                <div class="muted">{{ d.case.referral_reason }}</div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>

    <!-- ============ 弹窗集合 ============ -->
    <el-dialog v-model="dlg.checkin" title="前台到院核验" width="460px">
      <el-form label-width="100px">
        <el-form-item label="身份核验"><el-switch v-model="f.checkin.identityVerified" active-text="芯片号/外貌比对一致" /></el-form-item>
        <el-form-item label="代办授权码"><el-input v-model="f.checkin.authCode" placeholder="主人本人到场可留空；代办人填写如 A246810" /></el-form-item>
        <el-form-item label="费用确认"><el-switch v-model="f.checkin.feeVerified" active-text="已告知费用项目并确认" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="f.checkin.note" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.checkin=false">取消</el-button>
        <el-button type="primary" @click="act('checkin', f.checkin)">核验通过，转护士分诊</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.plan" title="调整到院计划" width="500px">
      <el-form label-width="92px">
        <el-form-item label="到院时间"><el-date-picker v-model="f.plan.appointmentAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width:100%" /></el-form-item>
        <el-form-item label="医生"><el-select v-model="f.plan.doctorId" clearable style="width:100%">
          <el-option v-for="x in doctors" :key="x.id" :label="x.display_name" :value="x.id" /></el-select></el-form-item>
        <el-form-item label="诊室"><el-select v-model="f.plan.roomId" clearable style="width:100%">
          <el-option v-for="x in rooms" :key="x.id" :label="x.name" :value="x.id" /></el-select></el-form-item>
        <el-form-item v-if="d.case.case_type==='vaccine'" label="疫苗批号"><el-select v-model="f.plan.batchId" clearable style="width:100%">
          <el-option v-for="x in batches" :key="x.id" :disabled="x.status!=='normal' || x.qty_available<=0"
            :label="`${x.product_name} ${x.batch_no}（库存${x.qty_available}）`" :value="x.id" /></el-select></el-form-item>
        <el-form-item label="应激方案"><el-input v-model="f.plan.stressPlan" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.plan=false">取消</el-button>
        <el-button type="primary" @click="act('plan', f.plan)">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.reschedule" title="临时改约" width="420px">
      <el-form label-width="90px">
        <el-form-item label="新时间"><el-date-picker v-model="f.reschedule.appointmentAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width:100%" /></el-form-item>
        <el-form-item label="原因"><el-input v-model="f.reschedule.reason" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.reschedule=false">取消</el-button>
        <el-button type="primary" @click="act('reschedule', f.reschedule)">确认改约</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.triage" title="护士分诊记录" width="460px">
      <el-form label-width="92px">
        <el-form-item label="体温(℃)"><el-input-number v-model="f.triage.tempC" :min="35" :max="43" :precision="1" :step="0.1" />
          <span v-if="f.triage.tempC>=39.5" style="color:#f56c6c;margin-left:8px">⚠ 发热，将自动暂缓</span></el-form-item>
        <el-form-item label="体重(kg)"><el-input-number v-model="f.triage.weightKg" :min="0" :precision="2" :step="0.1" /></el-form-item>
        <el-form-item label="精神状态"><el-select v-model="f.triage.spirit" style="width:100%">
          <el-option label="活泼" value="lively" /><el-option label="一般" value="normal" /><el-option label="沉郁" value="depressed" /></el-select></el-form-item>
        <el-form-item label="适合处置"><el-switch v-model="f.triage.suitable" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="f.triage.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.triage=false">取消</el-button>
        <el-button type="primary" @click="act('triage', f.triage)">提交分诊</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.preop" title="术前检查结论" width="460px">
      <el-form label-width="92px">
        <el-form-item v-for="k in [['cbc','血常规'],['biochem','生化'],['clotting','凝血']]" :key="k[0]" :label="k[1]">
          <el-radio-group v-model="f.preop[k[0]]"><el-radio value="normal">正常</el-radio><el-radio value="abnormal">异常</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="可麻醉"><el-switch v-model="f.preop.fitForAnesthesia" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="f.preop.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.preop=false">取消</el-button>
        <el-button type="primary" @click="act('preop', f.preop)">提交（异常将暂停手术）</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.vaccinate" title="执行疫苗接种" width="500px">
      <el-alert type="warning" :closable="false" title="系统将校验批号状态与库存；缺货/冷链中断/过期/召回将被拦截并要求调剂或改约。" style="margin-bottom:10px" />
      <el-form label-width="92px">
        <el-form-item label="疫苗批号"><el-select v-model="f.vaccinate.batchId" style="width:100%">
          <el-option v-for="x in batches.filter(b=>b.product_name&&(d.case.vaccine_name?true:true))" :key="x.id"
            :disabled="x.status!=='normal' || x.qty_available<=0"
            :label="`${x.product_name} ${x.batch_no} 库存${x.qty_available} ${batchStatusCN[x.status]}`" :value="x.id" /></el-select>
          <div v-if="currentBatch && currentBatch.status!=='normal'" style="color:#f56c6c;font-size:12px">
            ⚠ {{ currentBatch.cold_chain_note||batchStatusCN[currentBatch.status] }}
          </div>
        </el-form-item>
        <el-form-item label="针次"><el-input-number v-model="f.vaccinate.doseNo" :min="1" :max="9" /></el-form-item>
        <el-form-item label="接种部位"><el-input v-model="f.vaccinate.site" placeholder="颈部皮下" /></el-form-item>
        <el-form-item label="下一针日期"><el-date-picker v-model="f.vaccinate.nextDueOn" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.vaccinate=false">取消</el-button>
        <el-button type="primary" @click="act('vaccinate', f.vaccinate)">确认接种并扣减库存</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.surgery" title="手术记录" width="480px">
      <el-form label-width="92px">
        <el-form-item label="手术名称"><el-input v-model="f.surgery.surgeryName" placeholder="如 公犬去势术" /></el-form-item>
        <el-form-item label="麻醉方式"><el-input v-model="f.surgery.anesthesia" placeholder="吸入麻醉" /></el-form-item>
        <el-form-item label="伊丽莎白圈"><el-switch v-model="f.surgery.collar" active-text="已佩戴" /></el-form-item>
        <el-form-item label="圈尺寸"><el-input v-model="f.surgery.collarFit" /></el-form-item>
        <el-form-item label="术中记录"><el-input v-model="f.surgery.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.surgery=false">取消</el-button>
        <el-button type="danger" @click="act('surgery', f.surgery)">完成手术</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.orders" title="医嘱 + 处方" width="560px">
      <el-form label-width="80px">
        <el-form-item label="医嘱"><el-input v-model="f.orders.content" type="textarea" :rows="3" placeholder="伤口护理、饮食、佩戴伊丽莎白圈等" /></el-form-item>
        <el-form-item label="处方药品">
          <div v-for="(m,i) in f.orders.medications" :key="i" style="display:flex;gap:6px;margin-bottom:6px">
            <el-input v-model="m.drugName" placeholder="药名" style="width:150px" />
            <el-input v-model="m.dosage" placeholder="剂量" style="width:110px" />
            <el-input v-model="m.frequency" placeholder="频次" style="width:100px" />
            <el-input-number v-model="m.days" :min="1" placeholder="天" style="width:96px" />
            <el-input-number v-model="m.qty" :min="1" placeholder="量" style="width:80px" />
            <el-button link type="danger" @click="f.orders.medications.splice(i,1)">删</el-button>
          </div>
          <el-button size="small" @click="f.orders.medications.push({drugName:'',dosage:'',frequency:'',days:5,qty:1})">＋ 添加药品</el-button>
        </el-form-item>
        <el-form-item label="复诊日期"><el-date-picker v-model="f.orders.revisitOn" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.orders=false">取消</el-button>
        <el-button type="primary" @click="act('orders', f.orders)">开具（药房待发药）</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.dispense" :title="`药房发药：${dispensing?.drug_name||''}`" width="460px">
      <el-form label-width="100px">
        <el-form-item label="发药结果">
          <el-radio-group v-model="f.dispense.refused"><el-radio :value="false">正常发出</el-radio><el-radio :value="true">主人拒取</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="用药配合度" v-if="!f.dispense.refused">
          <el-select v-model="f.dispense.compliance" style="width:100%">
            <el-option label="配合正常" value="normal" />
            <el-option label="抗拒躲闪" value="resists" />
            <el-option label="喂后吐出" value="spits" />
            <el-option label="需辅助喂药" value="needs_assist" />
          </el-select>
        </el-form-item>
        <el-form-item label="交代备注"><el-input v-model="f.dispense.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.dispense=false">取消</el-button>
        <el-button type="primary" @click="submitDispense">确认</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.hospitalize" title="安排住院笼位" width="420px">
      <el-form label-width="80px">
        <el-form-item label="笼位"><el-select v-model="f.hospitalize.cageId" style="width:100%">
          <el-option v-for="c in cages.filter(x=>x.status==='free')" :key="c.id" :label="`${c.code}（${c.size}号）`" :value="c.id" /></el-select></el-form-item>
        <el-form-item label="护理备注"><el-input v-model="f.hospitalize.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.hospitalize=false">取消</el-button>
        <el-button type="warning" @click="act('hospitalize', f.hospitalize)">收入住院</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.wound" title="术后伤口 / 伊丽莎白圈巡查" width="440px">
      <el-form label-width="92px">
        <el-form-item label="伤口情况">
          <el-radio-group v-model="f.wound.status">
            <el-radio value="ok">干燥良好</el-radio><el-radio value="ooze">少量渗液</el-radio>
            <el-radio value="bleeding">渗血</el-radio><el-radio value="infected">疑似感染</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="伊丽莎白圈"><el-switch v-model="f.wound.collar" active-text="佩戴正常" inactive-text="曾挣脱(已重戴)" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="f.wound.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.wound=false">取消</el-button>
        <el-button type="primary" @click="act('wound', f.wound)">提交巡查</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.discharge" title="康复出院" width="420px">
      <el-form><el-form-item label="出院交代"><el-input v-model="f.discharge.note" type="textarea" :rows="3" placeholder="拆线时间、用药、复诊提醒" /></el-form-item></el-form>
      <template #footer><el-button @click="dlg.discharge=false">取消</el-button>
        <el-button type="success" @click="act('discharge', f.discharge)">办理出院</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.followup" title="登记回访结果" width="440px">
      <el-form label-width="90px">
        <el-form-item label="渠道"><el-radio-group v-model="f.followup.channel">
          <el-radio value="phone">电话</el-radio><el-radio value="wechat">微信</el-radio><el-radio value="onsite">到院</el-radio></el-radio-group></el-form-item>
        <el-form-item label="结果"><el-radio-group v-model="f.followup.result">
          <el-radio value="good">恢复良好</el-radio><el-radio value="concern">主人有疑虑</el-radio>
          <el-radio value="abnormal">异常（需复查）</el-radio><el-radio value="unreachable">未联系上</el-radio></el-radio-group></el-form-item>
        <el-form-item label="异常/反馈"><el-input v-model="f.followup.abnormal" type="textarea" :rows="3" placeholder="如 伤口轻微渗血、食欲…" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.followup=false">取消</el-button>
        <el-button type="primary" @click="act('followup', f.followup)">提交回访</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.followupPlan" title="安排回访计划" width="400px">
      <el-form label-width="90px">
        <el-form-item label="回访日期"><el-date-picker v-model="f.followupPlan.dueOn" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="渠道"><el-radio-group v-model="f.followupPlan.channel">
          <el-radio value="phone">电话</el-radio><el-radio value="wechat">微信</el-radio></el-radio-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.followupPlan=false">取消</el-button>
        <el-button type="primary" @click="act('followups/plan', f.followupPlan)">安排</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.billing" title="收费登记" width="480px">
      <div v-for="(it,i) in f.billing.items" :key="i" style="display:flex;gap:8px;margin-bottom:8px">
        <el-input v-model="it.item" placeholder="项目" /><el-input-number v-model="it.amount" :min="0" :precision="2" />
        <el-button link type="danger" @click="f.billing.items.splice(i,1)">删</el-button>
      </div>
      <el-button size="small" @click="f.billing.items.push({item:'',amount:0})">＋ 加项</el-button>
      <el-divider />
      <el-switch v-model="f.billing.paid" active-text="当场结清" />
      <template #footer><el-button @click="dlg.billing=false">取消</el-button>
        <el-button type="primary" @click="act('billing', f.billing)">入账</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.complaint" title="发起投诉" width="440px">
      <el-form label-width="80px">
        <el-form-item label="类型"><el-select v-model="f.complaint.topic" style="width:100%">
          <el-option label="收费问题" value="billing" /><el-option label="服务问题" value="service" />
          <el-option label="医疗质量" value="quality" /><el-option label="其他" value="other" /></el-select></el-form-item>
        <el-form-item label="内容"><el-input v-model="f.complaint.content" type="textarea" :rows="4" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.complaint=false">取消</el-button>
        <el-button type="danger" @click="act('complaint', f.complaint)">提交，前台将在同一病例处理</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.photo" title="上传术后/病情照片" width="440px">
      <el-upload :show-file-list="false" :before-upload="pickPhoto" accept="image/*"><el-button>选择图片</el-button></el-upload>
      <img v-if="f.photo.dataUrl" :src="f.photo.dataUrl" style="max-width:100%;margin-top:10px" />
      <el-input v-model="f.photo.caption" placeholder="图片说明（如：术后第2天伤口）" style="margin-top:8px" />
      <template #footer><el-button @click="dlg.photo=false">取消</el-button>
        <el-button type="primary" @click="act('photo', f.photo)">上传到长期档案</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.toOnsite" title="在线问诊转为到院" width="440px">
      <el-form label-width="90px">
        <el-form-item label="到院时间"><el-date-picker v-model="f.toOnsite.appointmentAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width:100%" /></el-form-item>
        <el-form-item label="到院类型"><el-select v-model="f.toOnsite.caseType" style="width:100%">
          <el-option label="复诊/检查" value="followup" /><el-option label="疫苗接种" value="vaccine" /><el-option label="手术" value="surgery" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.toOnsite=false">取消</el-button>
        <el-button type="primary" @click="act('to-onsite', f.toOnsite)">转到院（图文记录随病例保留）</el-button></template>
    </el-dialog>

    <el-dialog v-model="dlg.refer" title="跨院转诊" width="440px">
      <el-form label-width="90px">
        <el-form-item label="接收医院"><el-input v-model="f.refer.hospital" placeholder="如 市中心宠物医院·影像中心" /></el-form-item>
        <el-form-item label="转诊原因"><el-input v-model="f.refer.reason" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg.refer=false">取消</el-button>
        <el-button type="primary" @click="act('refer', f.refer)">确认转诊并打包病例</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import api, { CASE_STATUS, CASE_TYPE, STATUS_TYPE, EVENT_META, fmt, day } from '../api.js';
import { ElMessage } from 'element-plus';

const route = useRoute();
const d = ref(null);
const role = JSON.parse(localStorage.getItem('user')).role;
const roleCN = { owner: '主人', reception: '前台', doctor: '医生', nurse: '护士', pharmacy: '药房', admin: '管理员', system: '系统' };
const spiritCN = { lively: '活泼', normal: '一般', depressed: '沉郁' };
const woundCN = { ok: '愈合良好', ooze: '少量渗液', bleeding: '渗血', infected: '疑似感染' };
const medStatusCN = { prescribed: '待发药', dispensed: '已发药', refused: '已拒取', cooperation_issue: '配合问题' };
const compCN = { normal: '', resists: '抗拒', spits: '吐药', needs_assist: '需辅助' };
const fuCN = { good: '恢复良好', concern: '有疑虑', abnormal: '异常', unreachable: '未联系上' };
const batchStatusCN = { normal: '正常', shortage: '缺货', expired: '过期', cold_chain_break: '冷链中断', recall: '召回' };
const tab = ref('triage');
const cages = ref([]); const batches = ref([]); const doctors = ref([]); const rooms = ref([]);
const chatText = ref('');
const dispensing = ref(null);
const chatRef = ref(null);

const dlg = reactive({});
const f = reactive({
  checkin: { identityVerified: true, authCode: '', feeVerified: false, note: '' },
  plan: { appointmentAt: null, doctorId: null, roomId: null, batchId: null, stressPlan: '' },
  reschedule: { appointmentAt: null, reason: '' },
  triage: { tempC: 38.5, weightKg: null, spirit: 'normal', suitable: true, note: '' },
  preop: { cbc: 'normal', biochem: 'normal', clotting: 'normal', fitForAnesthesia: true, note: '' },
  vaccinate: { batchId: null, doseNo: 1, site: '颈部皮下', nextDueOn: null },
  surgery: { surgeryName: '', anesthesia: '吸入麻醉', collar: true, collarFit: '尺寸合适', note: '' },
  orders: { content: '', medications: [], revisitOn: null },
  dispense: { refused: false, compliance: 'normal', note: '' },
  hospitalize: { cageId: null, note: '' },
  wound: { status: 'ooze', collar: true, note: '' },
  discharge: { note: '' },
  followup: { channel: 'phone', result: 'good', abnormal: '' },
  followupPlan: { dueOn: null, channel: 'phone' },
  billing: { items: [{ item: '', amount: 0 }], paid: false },
  complaint: { topic: 'billing', content: '' },
  photo: { dataUrl: '', caption: '' },
  toOnsite: { appointmentAt: null, caseType: 'followup' },
  refer: { hospital: '', reason: '' },
});

const st = computed(() => d.value.case.status);
const canChat = computed(() => role === 'owner' || role === 'doctor' || (d.value?.case.channel === 'online'));
const currentBatch = computed(() => batches.value.find(b => b.id === f.vaccinate.batchId));
const batchTagType = computed(() => {
  const b = batches.value.find(x => x.batch_no === d.value.case.batch_no);
  return !b || b.status === 'normal' ? 'success' : 'danger';
});
const medTagType = (m) => m.status === 'prescribed' ? 'warning' : m.status === 'refused' ? 'info' : m.compliance === 'normal' ? 'success' : 'danger';
const fuType = (r) => ({ good: 'success', concern: 'warning', abnormal: 'danger', unreachable: 'info' }[r] || 'info');
const batchNo = (id) => batches.value.find(b => b.id === id)?.batch_no || id;

async function load() {
  d.value = (await api.get(`/cases/${route.params.id}`)).data;
  const [cg, ba, dr, rm] = await Promise.all([
    api.get('/caches').catch(() => ({ data: [] })),
    api.get('/vaccine-batches'), api.get('/doctors'), api.get('/rooms')]);
  cages.value = cg.data; batches.value = ba.data; doctors.value = dr.data; rooms.value = rm.data;
  f.plan.doctorId = d.value.case.doctor_id; f.plan.roomId = d.value.case.room_id;
  f.plan.batchId = d.value.case.batch_id; f.plan.appointmentAt = d.value.case.appointment_at;
  f.triage.weightKg = null;
}

async function act(pathSuffix, body) {
  await api.post(`/cases/${route.params.id}/${pathSuffix}`, body);
  ElMessage.success('已记录到统一病例');
  Object.keys(dlg).forEach(k => (dlg[k] = false));
  await load();
}

function openDispense(m) { dispensing.value = m; f.dispense.refused = false; f.dispense.compliance = 'normal'; f.dispense.note = ''; dlg.dispense = true; }
async function submitDispense() {
  await api.post(`/cases/${route.params.id}/dispense/${dispensing.value.id}`, f.dispense);
  ElMessage.success('发药结果已写入病例');
  dlg.dispense = false;
  await load();
}

async function sendMsg() {
  if (!chatText.value.trim()) return;
  await api.post(`/cases/${route.params.id}/consult`, { content: chatText.value, msgType: 'text' });
  chatText.value = '';
  await load();
}
function sendImage(file) {
  const rd = new FileReader();
  rd.onload = async () => {
    await api.post(`/cases/${route.params.id}/consult`, { content: file.name, msgType: 'image', imageUrl: rd.result });
    ElMessage.success('图片已发送并归档');
    await load();
  };
  rd.readAsDataURL(file);
  return false;
}
function pickPhoto(file) {
  const rd = new FileReader();
  rd.onload = () => (f.photo.dataUrl = rd.result);
  rd.readAsDataURL(file);
  return false;
}
onMounted(load);
</script>
<style scoped>
.rec { padding: 6px 0; border-bottom: 1px dashed #e5ebe7; font-size: 13px; line-height: 1.7; }
</style>
