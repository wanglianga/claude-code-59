import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/login', component: () => import('./views/Login.vue') },
  { path: '/', component: () => import('./views/Dashboard.vue') },
  { path: '/pets', component: () => import('./views/Pets.vue') },
  { path: '/pets/:id', component: () => import('./views/PetArchive.vue') },
  { path: '/cases', component: () => import('./views/CaseList.vue') },
  { path: '/cases/:id', component: () => import('./views/CaseDetail.vue') },
  { path: '/resources', component: () => import('./views/Resources.vue') },
  { path: '/quality', component: () => import('./views/Quality.vue') },
  { path: '/complaints', component: () => import('./views/Complaints.vue') },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to) => {
  const token = localStorage.getItem('token');
  if (!token && to.path !== '/login') return '/login';
  if (token && to.path === '/login') return '/';
  return true;
});

export default router;
