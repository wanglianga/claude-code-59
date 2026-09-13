<template>
  <router-view v-if="isLogin" />
  <el-container v-else style="height:100%">
    <el-aside width="218px" style="background:#234235;color:#cfe3d9">
      <div style="padding:18px 16px;font-size:16px;font-weight:700;color:#fff;line-height:1.4">
        🐾 城市宠物医院
        <div style="font-size:11px;font-weight:400;color:#9dc7b6;margin-top:2px">疫苗接种与术后回访平台</div>
      </div>
      <el-menu :default-active="$route.path" router background-color="#234235" text-color="#cfe3d9"
               active-text-color="#ffffff" style="border:none">
        <el-menu-item index="/"><el-icon><Odometer /></el-icon><span>{{ role === 'owner' ? '我的看板' : '工作台' }}</span></el-menu-item>
        <el-menu-item index="/cases"><el-icon><FolderOpened /></el-icon><span>病例{{ role === 'owner' ? '' : '总览' }}</span></el-menu-item>
        <el-menu-item index="/pets"><el-icon><Coin /></el-icon><span>{{ role === 'owner' ? '我的宠物' : '宠物档案' }}</span></el-menu-item>
        <template v-if="role !== 'owner'">
          <el-menu-item index="/resources"><el-icon><Setting /></el-icon><span>排班·笼位·冷链</span></el-menu-item>
          <el-menu-item v-if="['reception','admin'].includes(role)" index="/complaints">
            <el-icon><Comment /></el-icon><span>投诉处理</span></el-menu-item>
          <el-menu-item v-if="['admin','doctor','nurse','pharmacy'].includes(role)" index="/quality">
            <el-icon><TrendCharts /></el-icon><span>质量复盘/排查</span></el-menu-item>
        </template>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header style="background:#fff;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e7ede9">
        <div class="muted">同一病例 · 前台 / 医生 / 护士 / 药房 / 主人 在线协作</div>
        <div>
          <el-tag type="success" effect="plain" style="margin-right:10px">{{ roleName }}</el-tag>
          <b>{{ user?.displayName }}</b>
          <el-button link type="primary" style="margin-left:14px" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f4f6f5">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ROLE } from './api.js';

const route = useRoute();
const router = useRouter();
const isLogin = computed(() => route.path === '/login');
const user = computed(() => {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
});
const role = computed(() => user.value?.role);
const roleName = computed(() => ROLE[role.value] || '');
function logout() {
  localStorage.clear();
  router.push('/login');
}
</script>
