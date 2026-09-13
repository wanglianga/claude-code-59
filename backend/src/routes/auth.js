import bcrypt from 'bcryptjs';
import { q } from '../db.js';
import { sign } from '../auth.js';
import { asyncRouter } from '../asyncify.js';

const r = asyncRouter();

r.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });
  const { rows } = await q('SELECT * FROM users WHERE username=$1 AND active=TRUE', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: '账号或密码错误' });
  const token = sign(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, phone: user.phone, title: user.title },
  });
});

export default r;
