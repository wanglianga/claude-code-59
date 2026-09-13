-- =====================================================================
-- 城市宠物医院 · 疫苗接种与术后回访平台 数据库结构
-- 核心设计：cases（一次就诊）+ case_events（统一病例时间线）
-- 前台/医生/护士/药房/主人、线上图文咨询/到院检查/现场医嘱全部挂到同一病例
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- 用户与角色 ----------
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(64) NOT NULL,
  role          VARCHAR(16) NOT NULL CHECK (role IN ('owner','reception','doctor','nurse','pharmacy','admin')),
  phone         VARCHAR(32),
  title         VARCHAR(64),
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 主人代授权（主人代办：家人/朋友代办，限期授权码）
CREATE TABLE owner_authorizations (
  id           BIGSERIAL PRIMARY KEY,
  owner_id     BIGINT NOT NULL REFERENCES users(id),
  pet_id       BIGINT,
  agent_name   VARCHAR(64) NOT NULL,
  agent_phone  VARCHAR(32) NOT NULL,
  auth_code    VARCHAR(16) UNIQUE NOT NULL,
  scope        VARCHAR(255) DEFAULT '陪同就诊、签署知情同意、缴费取药',
  valid_from   TIMESTAMPTZ DEFAULT now(),
  valid_until  TIMESTAMPTZ NOT NULL,
  revoked      BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ---------- 宠物长期档案 ----------
CREATE TABLE pets (
  id              BIGSERIAL PRIMARY KEY,
  owner_id        BIGINT NOT NULL REFERENCES users(id),
  name            VARCHAR(64) NOT NULL,
  species         VARCHAR(8) NOT NULL CHECK (species IN ('cat','dog')),
  breed           VARCHAR(64) NOT NULL,
  gender          VARCHAR(8) NOT NULL CHECK (gender IN ('male','female')),
  birth_date      DATE,
  age_months      INT,
  weight_kg       NUMERIC(5,2),
  neutered        BOOLEAN DEFAULT FALSE,
  microchip_no    VARCHAR(32),
  allergies       TEXT,
  chronic_diseases TEXT,
  stress_level    SMALLINT DEFAULT 1 CHECK (stress_level BETWEEN 1 AND 5), -- 应激程度
  temper_note     VARCHAR(255),
  photo_url       VARCHAR(255),
  lost_status     VARCHAR(16) DEFAULT 'none' CHECK (lost_status IN ('none','missing','found')),
  lost_note       TEXT,
  lost_at         TIMESTAMPTZ,
  found_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_pets_owner ON pets(owner_id);
CREATE INDEX idx_pets_name_trgm ON pets USING gin (name gin_trgm_ops);

CREATE TABLE pet_vaccine_history (   -- 既往疫苗
  id          BIGSERIAL PRIMARY KEY,
  pet_id      BIGINT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  vaccine_name VARCHAR(64) NOT NULL,
  dose_no     SMALLINT,
  vaccinated_on DATE NOT NULL,
  next_due_on DATE,
  hospital    VARCHAR(128),
  batch_no    VARCHAR(64),
  note        TEXT
);
CREATE TABLE pet_deworming (          -- 驱虫记录
  id          BIGSERIAL PRIMARY KEY,
  pet_id      BIGINT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  product     VARCHAR(64) NOT NULL,
  dewormed_on DATE NOT NULL,
  next_due_on DATE,
  kind        VARCHAR(16) DEFAULT 'internal' CHECK (kind IN ('internal','external','both'))
);

-- ---------- 医院资源：排班 / 诊室 / 笼位 / 疫苗冷链 ----------
CREATE TABLE rooms (
  id       BIGSERIAL PRIMARY KEY,
  name     VARCHAR(32) UNIQUE NOT NULL,
  room_type VARCHAR(16) DEFAULT 'consult' CHECK (room_type IN ('consult','surgery','observation')),
  active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE doctor_schedules (
  id          BIGSERIAL PRIMARY KEY,
  doctor_id   BIGINT NOT NULL REFERENCES users(id),
  work_date   DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  slot_minutes SMALLINT DEFAULT 30,
  UNIQUE (doctor_id, work_date, start_time)
);

CREATE TABLE cages (                  -- 住院笼位
  id         BIGSERIAL PRIMARY KEY,
  code       VARCHAR(16) UNIQUE NOT NULL,
  size       VARCHAR(8) CHECK (size IN ('S','M','L')),
  status     VARCHAR(16) DEFAULT 'free' CHECK (status IN ('free','occupied','cleaning')),
  current_pet_id BIGINT REFERENCES pets(id),
  note       TEXT
);

CREATE TABLE vaccine_products (
  id        BIGSERIAL PRIMARY KEY,
  name      VARCHAR(64) NOT NULL,
  species   VARCHAR(8) CHECK (species IN ('cat','dog','both')),
  maker     VARCHAR(128),
  dose_total SMALLINT DEFAULT 1,
  active    BOOLEAN DEFAULT TRUE
);

CREATE TABLE vaccine_batches (        -- 疫苗批号 + 冷链
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES vaccine_products(id),
  batch_no        VARCHAR(64) UNIQUE NOT NULL,
  expire_on       DATE NOT NULL,
  qty_in          INT NOT NULL DEFAULT 0,
  qty_used        INT NOT NULL DEFAULT 0,
  status          VARCHAR(24) DEFAULT 'normal'
                  CHECK (status IN ('normal','shortage','expired','cold_chain_break','recall')),
  storage_temp_lo NUMERIC(4,1) DEFAULT 2.0,
  storage_temp_hi NUMERIC(4,1) DEFAULT 8.0,
  cold_chain_note TEXT,
  inbound_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------- 统一病例（一次就诊/咨询） ----------
CREATE TABLE cases (
  id            BIGSERIAL PRIMARY KEY,
  case_no       VARCHAR(24) UNIQUE NOT NULL,
  pet_id        BIGINT NOT NULL REFERENCES pets(id),
  owner_id      BIGINT NOT NULL REFERENCES users(id),
  case_type     VARCHAR(16) NOT NULL CHECK (case_type IN ('vaccine','surgery','online','followup')),
  channel       VARCHAR(16) DEFAULT 'onsite' CHECK (channel IN ('onsite','online')),
  status        VARCHAR(24) NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked','planned','arrived','triaged','contraindicated',
                                  'in_progress','completed','hospitalized','discharged',
                                  'rescheduled','cancelled','referred','closed')),
  -- 预约/到院计划
  appointment_at TIMESTAMPTZ,
  doctor_id      BIGINT REFERENCES users(id),
  room_id        BIGINT REFERENCES rooms(id),
  batch_id       BIGINT REFERENCES vaccine_batches(id),
  fasting_hours  SMALLINT DEFAULT 0,          -- 禁食要求
  preop_required BOOLEAN DEFAULT FALSE,       -- 是否需要术前检查
  stress_plan    VARCHAR(255),                -- 应激安抚方案
  plan_note      TEXT,
  -- 前台核验
  check_in_at    TIMESTAMPTZ,
  identity_verified BOOLEAN DEFAULT FALSE,
  auth_verified  BOOLEAN DEFAULT FALSE,
  auth_id        BIGINT REFERENCES owner_authorizations(id),
  fee_verified   BOOLEAN DEFAULT FALSE,
  reception_note TEXT,
  -- 跨院转诊
  referral_out_hospital VARCHAR(128),
  referral_reason TEXT,
  referral_in_from VARCHAR(128),
  -- 收费
  total_fee      NUMERIC(10,2) DEFAULT 0,
  fee_paid       BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_cases_pet ON cases(pet_id);
CREATE INDEX idx_cases_owner ON cases(owner_id);
CREATE INDEX idx_cases_status ON cases(status);
CREATE INDEX idx_cases_doctor ON cases(doctor_id);
CREATE INDEX idx_cases_appt ON cases(appointment_at);

-- 病例时间线：所有角色、线上线下的记录都进同一张表
CREATE TABLE case_events (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pet_id      BIGINT NOT NULL REFERENCES pets(id),
  event_type  VARCHAR(32) NOT NULL,   -- booking/triage/preop/vaccination/surgery/order/medication/
                                      -- photo/followup/feedback/consult/referral/lost/complaint/
                                      -- hospitalization/billing/checkin/plan/remark
  author_id   BIGINT REFERENCES users(id),
  author_role VARCHAR(16),
  title       VARCHAR(255),
  content     TEXT,
  data        JSONB,
  visible_to_owner BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_events_case ON case_events(case_id, created_at);
CREATE INDEX idx_events_pet ON case_events(pet_id, created_at);

-- 护士分诊
CREATE TABLE triages (
  id           BIGSERIAL PRIMARY KEY,
  case_id      BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  nurse_id     BIGINT NOT NULL REFERENCES users(id),
  temp_c       NUMERIC(4,1),
  weight_kg    NUMERIC(5,2),
  spirit       VARCHAR(16) CHECK (spirit IN ('lively','normal','depressed')),
  appetite     VARCHAR(16),
  suitable     BOOLEAN NOT NULL,           -- 是否适合接种/麻醉
  decision     VARCHAR(24) CHECK (decision IN ('proceed','hold_fever','hold_preop_abnormal','hold_other','reschedule')),
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 术前检查
CREATE TABLE preop_exams (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id   BIGINT REFERENCES users(id),
  cbc         VARCHAR(32),                  -- 血常规结论 normal/abnormal
  biochem     VARCHAR(32),
  clotting    VARCHAR(32),
  result      VARCHAR(16) CHECK (result IN ('normal','abnormal','pending')),
  fit_for_anesthesia BOOLEAN,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 接种记录
CREATE TABLE vaccinations (
  id           BIGSERIAL PRIMARY KEY,
  case_id      BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pet_id       BIGINT NOT NULL REFERENCES pets(id),
  batch_id     BIGINT REFERENCES vaccine_batches(id),
  doctor_id    BIGINT REFERENCES users(id),
  vaccine_name VARCHAR(64) NOT NULL,
  dose_no      SMALLINT,
  site         VARCHAR(32),
  next_due_on  DATE,
  given_at     TIMESTAMPTZ DEFAULT now(),
  adverse      TEXT
);

-- 手术记录
CREATE TABLE surgeries (
  id             BIGSERIAL PRIMARY KEY,
  case_id        BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pet_id         BIGINT NOT NULL REFERENCES pets(id),
  doctor_id      BIGINT REFERENCES users(id),
  surgery_name   VARCHAR(128) NOT NULL,
  anesthesia     VARCHAR(64),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  wound_status   VARCHAR(24) DEFAULT 'ok' CHECK (wound_status IN ('ok','ooze','bleeding','infected')),
  elizabeth_collar BOOLEAN DEFAULT TRUE,    -- 术后伊丽莎白圈
  collar_fit     VARCHAR(32),
  note           TEXT
);

-- 医嘱与用药
CREATE TABLE medical_orders (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id   BIGINT REFERENCES users(id),
  content     TEXT NOT NULL,                -- 医嘱
  revisit_on  DATE,                        -- 复诊时间
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE medications (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  drug_name   VARCHAR(96) NOT NULL,
  dosage      VARCHAR(64),
  frequency   VARCHAR(64),
  days        SMALLINT,
  qty         SMALLINT DEFAULT 1,
  status      VARCHAR(24) DEFAULT 'prescribed'
              CHECK (status IN ('prescribed','dispensed','refused','cooperation_issue')),
  compliance  VARCHAR(24) DEFAULT 'normal'
              CHECK (compliance IN ('normal','resists','spits','needs_assist')), -- 用药配合度
  note        TEXT,
  dispensed_at TIMESTAMPTZ,
  pharmacist_id BIGINT REFERENCES users(id)
);

-- 住院
CREATE TABLE hospitalizations (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pet_id      BIGINT NOT NULL REFERENCES pets(id),
  cage_id     BIGINT REFERENCES cages(id),
  admitted_at TIMESTAMPTZ DEFAULT now(),
  discharged_at TIMESTAMPTZ,
  status      VARCHAR(16) DEFAULT 'admitted' CHECK (status IN ('admitted','discharged')),
  wound_check  TEXT,
  note        TEXT
);

-- 术后回访
CREATE TABLE followups (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pet_id      BIGINT NOT NULL REFERENCES pets(id),
  due_on      DATE NOT NULL,
  channel     VARCHAR(16) DEFAULT 'phone' CHECK (channel IN ('phone','wechat','onsite')),
  result      VARCHAR(16) CHECK (result IN ('good','concern','abnormal','unreachable')),
  abnormal    TEXT,                         -- 异常反馈（伤口渗血等）
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_followups_due ON followups(due_on);

-- 投诉（收费等）
CREATE TABLE complaints (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT REFERENCES cases(id),
  owner_id    BIGINT NOT NULL REFERENCES users(id),
  topic       VARCHAR(24) NOT NULL CHECK (topic IN ('billing','service','quality','other')),
  content     TEXT NOT NULL,
  status      VARCHAR(16) DEFAULT 'open' CHECK (status IN ('open','handling','resolved','closed')),
  handler_id  BIGINT REFERENCES users(id),
  reply       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 在线图文问诊（并入同一 case）
CREATE TABLE consultations (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  sender_id   BIGINT NOT NULL REFERENCES users(id),
  sender_role VARCHAR(16) NOT NULL,
  msg_type    VARCHAR(12) DEFAULT 'text' CHECK (msg_type IN ('text','image')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 下一针 / 复诊提醒
CREATE TABLE reminders (
  id          BIGSERIAL PRIMARY KEY,
  pet_id      BIGINT NOT NULL REFERENCES pets(id),
  case_id     BIGINT REFERENCES cases(id),
  kind        VARCHAR(16) NOT NULL CHECK (kind IN ('vaccine','revisit','deworm','followup')),
  title       VARCHAR(128) NOT NULL,
  due_on      DATE NOT NULL,
  status      VARCHAR(12) DEFAULT 'pending' CHECK (status IN ('pending','sent','done','snoozed')),
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reminders_due ON reminders(due_on, status);

-- 发票/收费明细
CREATE TABLE invoices (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  item        VARCHAR(96) NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- updated_at 自动维护
CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cases_touch BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION touch_row();
