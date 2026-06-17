// 生成 TabBar 图标：81x81 PNG，5 个图标 × 2 种颜色（灰/紫）= 10 张
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 81;
const GRAY = [0x99, 0x99, 0x99, 0xFF];
const PURPLE = [0x5C, 0x6B, 0xC0, 0xFF];
const TRANS = [0x00, 0x00, 0x00, 0x00];

function createBuffer() {
  return Buffer.alloc(SIZE * SIZE * 4, 0);
}

function setPixel(buf, x, y, color) {
  const cx = Math.round(x), cy = Math.round(y);
  if (cx < 0 || cx >= SIZE || cy < 0 || cy >= SIZE) return;
  const i = (cy * SIZE + cx) * 4;
  buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = color[3];
}

function fillCircle(buf, cx, cy, r, color) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
        setPixel(buf, x, y, color);
      }
    }
  }
}

function fillRect(buf, rx, ry, rw, rh, color) {
  for (let y = Math.max(0, Math.round(ry)); y < Math.min(SIZE, Math.round(ry + rh)); y++) {
    for (let x = Math.max(0, Math.round(rx)); x < Math.min(SIZE, Math.round(rx + rw)); x++) {
      setPixel(buf, x, y, color);
    }
  }
}

function strokeLine(buf, x1, y1, x2, y2, width, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t, cy = y1 + dy * t;
    fillCircle(buf, cx, cy, width / 2, color);
  }
}

// === 图标绘制函数 ===

// 首页 - 房子
function drawHome(buf, color) {
  const c = color;
  // 屋顶
  fillRect(buf, 8, 28, 65, 8, c);   // 屋顶横梁
  // 左边斜顶
  for (let y = 8; y <= 28; y++) {
    const slope = (y - 8) / 20;
    const x1 = 40 - 30 * (1 - slope);
    const x2 = 40 + 30 * (1 - slope);
    for (let x = x1; x <= x2; x++) {
      setPixel(buf, x, y, c);
    }
  }
  // 墙体
  fillRect(buf, 12, 36, 57, 37, c);
  // 门
  fillRect(buf, 32, 48, 18, 28, TRANS);
  // 门框描边
  fillRect(buf, 30, 48, 2, 28, c);
  fillRect(buf, 50, 48, 2, 28, c);
  fillRect(buf, 30, 74, 22, 2, c);
}

// 心愿 - 心形
function drawHeart(buf, color) {
  const c = color;
  const cx = 40, cy = 42;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - cx) / 18;
      const dy = (y - cy) / 18;
      // Heart equation: (x^2 + y^2 - 1)^3 - x^2*y^3 <= 0
      const val = Math.pow(dx * dx + dy * dy - 1, 3) - dx * dx * dy * dy * dy;
      if (val <= 0.05) {
        setPixel(buf, x, y, c);
      }
    }
  }
}

// 存款池 - 存钱罐/金币
function drawPool(buf, color) {
  const c = color;
  const cx = 40, cy = 38, r = 22;
  // 圆形主体
  fillCircle(buf, cx, cy, r, c);
  // 顶部投币口
  fillRect(buf, 30, 14, 20, 10, c);
  fillRect(buf, 34, 8, 12, 10, c);
  // 内部镂空 ¥ 符号
  fillRect(buf, 32, 28, 4, 24, TRANS);
  // ¥ 两横
  fillRect(buf, 26, 30, 28, 4, c);
  fillRect(buf, 28, 42, 24, 4, c);
  // 竖
  fillRect(buf, 38, 28, 4, 24, TRANS);
}

// 统计 - 柱状图
function drawStats(buf, color) {
  const c = color;
  // 三个柱子
  fillRect(buf, 10, 48, 16, 28, c);  // 左
  fillRect(buf, 32, 32, 16, 44, c);  // 中
  fillRect(buf, 54, 40, 16, 36, c);  // 右
  // 底部基线
  fillRect(buf, 6, 74, 68, 3, c);
}

// 我的 - 人物
function drawMine(buf, color) {
  const c = color;
  // 头
  fillCircle(buf, 40, 24, 14, c);
  // 身体
  fillRect(buf, 28, 40, 24, 22, c);
  // 肩膀圆角 - 用圆形叠加
  fillCircle(buf, 28, 42, 10, c);
  fillCircle(buf, 52, 42, 10, c);
  // 脖子连接
  fillRect(buf, 34, 36, 12, 8, c);
}

// === PNG 编码 ===

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcData = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function encodePNG(pixels) {
  // Filter each scanline
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4); // filter byte + pixels
    row[0] = 0; // filter: None
    pixels.copy(row, 1, y * SIZE * 4, (y + 1) * SIZE * 4);
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(SIZE, 0);  // width
  ihdrData.writeUInt32BE(SIZE, 4);  // height
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type: RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace

  return Buffer.concat([
    signature,
    createChunk('IHDR', ihdrData),
    createChunk('IDAT', compressed),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

// === 生成全部图标 ===

const ICONS = [
  { name: 'drawHome', fn: drawHome, label: 'home' },
  { name: 'drawHeart', fn: drawHeart, label: 'heart' },
  { name: 'drawPool', fn: drawPool, label: 'pool' },
  { name: 'drawStats', fn: drawStats, label: 'stats' },
  { name: 'drawMine', fn: drawMine, label: 'mine' },
];

const TAB_NAMES = ['index', 'wishlist', 'pool', 'stats', 'mine'];
const OUT_DIR = path.join(__dirname, 'miniprogram', 'images');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

for (let i = 0; i < ICONS.length; i++) {
  const { fn, label } = ICONS[i];
  const tabName = TAB_NAMES[i];

  // 灰色（未选中）
  const grayBuf = createBuffer();
  fn(grayBuf, GRAY);
  const grayPng = encodePNG(grayBuf);
  fs.writeFileSync(path.join(OUT_DIR, `tab-${tabName}.png`), grayPng);
  console.log(`  tab-${tabName}.png (gray) — ${grayPng.length} bytes`);

  // 紫色（选中）
  const purpleBuf = createBuffer();
  fn(purpleBuf, PURPLE);
  const purplePng = encodePNG(purpleBuf);
  fs.writeFileSync(path.join(OUT_DIR, `tab-${tabName}-active.png`), purplePng);
  console.log(`  tab-${tabName}-active.png (purple) — ${purplePng.length} bytes`);
}

console.log(`\nDone! ${ICONS.length * 2} icons generated in ${OUT_DIR}`);
