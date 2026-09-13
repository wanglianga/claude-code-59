import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import * as Icons from '@element-plus/icons-vue';
import App from './App.vue';
import router from './router.js';
import './style.css';

const app = createApp(App);
for (const [k, v] of Object.entries(Icons)) app.component(k, v);
app.use(ElementPlus, { locale: zhCn });
app.use(router);
app.mount('#app');
