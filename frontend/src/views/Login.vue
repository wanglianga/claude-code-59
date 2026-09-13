<template>
  <div class="login-bg">
    <div class="login-card">
      <h2>🐾 城市宠物医院</h2>
      <div class="muted" style="margin-bottom:18px">疫苗接种与术后回访平台</div>
      <el-form @submit.prevent="login">
        <el-form-item>
          <el-input v-model="form.username" size="large" placeholder="账号" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" size="large" type="password" placeholder="密码（演示账号统一 123456）"
                    :prefix-icon="Lock" show-password @keyup.enter="login" />
        </el-form-item>
        <el-button type="primary" size="large" style="width:100%;background:#2f7d61;border-color:#2f7d61"
                   :loading="loading" @click="login">登 录</el-button>
      </el-form>
      <el-divider>演示账号（点击填充，密码均 123456）</el-divider>
      <div class="role-chips" style="line-height:2.1">
        <el-tag v-for="a in accounts" :key="a.u" effect="plain" style="cursor:pointer"
                @click="form.username=a.u;form.password='123456'">
          {{ a.label }} · {{ a.u }}
        </el-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { User, Lock } from '@element-plus/icons-vue';
import api from '../api.js';
import { ElMessage } from 'element-plus';

const router = useRouter();
const form = reactive({ username: '', password: '' });
const loading = ref(false);
const accounts = [
  { u: 'wangmeili', label: '主人·王美丽' },
  { u: 'lizhiqiang', label: '主人·李志强' },
  { u: 'zhangmin', label: '前台·张敏' },
  { u: 'chenaisi', label: '医生·陈爱思' },
  { u: 'wangdafu', label: '医生·王大福' },
  { u: 'huxiaojing', label: '护士·胡小静' },
  { u: 'liuyao', label: '药房·刘药' },
  { u: 'zhouyuan', label: '院长·周院长' },
];

async function login() {
  if (!form.username || !form.password) return ElMessage.warning('请输入账号密码');
  loading.value = true;
  try {
    const { data } = await api.post('/auth/login', form);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    ElMessage.success(`欢迎，${data.user.displayName}`);
    router.push('/');
  } finally {
    loading.value = false;
  }
}
</script>
