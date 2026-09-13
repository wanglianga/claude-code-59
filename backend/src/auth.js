import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'pet-hospital-dev-secret';

export function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.display_name },
    SECRET,
    { expiresIn: '12h' }
  );
}

export function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: '当前角色无权执行该操作' });
    next();
  };
}

export const STAFF = ['reception', 'doctor', 'nurse', 'pharmacy', 'admin'];
