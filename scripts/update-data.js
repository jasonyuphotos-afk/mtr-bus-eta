const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

// ============================================
// 設定
// ============================================

const CSV_URLS = {
  routes: 'https://opendata.mtr.com.hk/data/mtr_bus_routes.csv',
  routeStops: 'https://opendata.mtr.com.hk/data/mtr_bus_stops.csv',
};

const OUTPUT_DIR = path.join(__dirname, '..', 'data');

// ============================================
// 工具函數
// ============================================

async function downloadCSV(url, label) {
  console.log(`  📡 [${label}] 下載中...`);
  
  const response = await axios.get(url, {
    responseType: 'text',
    timeout: 30000,
  });
  
  console.log(`     HTTP 狀態: ${response.status}`);
  console.log(`     資料長度: ${response.data.length} 字元`);
  
  const parsed = parse(response.data, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  
  console.log(`     解析到 ${parsed.length} 行`);
  
  if (parsed.length > 0) {
    console.log(`     欄位: ${Object.keys(parsed[0]).join(', ')}`);
  }
  
  return parsed;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================
// 資料轉換
// ============================================

function transformData(routesRaw, routeStopsRaw) {
  console.log('');
  console.log('🔄 轉換資料格式...');

  // === 建立路線資訊 ===
  // 格式: { routeId: { name, destinations: [] } }
  const routeInfo = {};

  for (const row of routesRaw) {
    const routeId = row['ROUTE_ID'] || '';
    const name = row['ROUTE_NAME_CHI'] || '';
    
    if (routeId && name) {
      // 路線名格式: "屯門碼頭至兆麟" -> 提取目的地
      const parts = name.split('至');
      const destination = parts.length > 1 ? parts[1].trim() : name;
      
      if (!routeInfo[routeId]) {
        routeInfo[routeId] = { name, destinations: [] };
      }
      routeInfo[routeId].destinations.push(destination);
    }
  }

  // === 建立車站資料庫 ===
  // 格式: { stationId: { name, lat, lng } }
  const stopDb = {};

  for (const row of routeStopsRaw) {
    const stationId = row['STATION_ID'] || '';
    const name = row['STATION_NAME_CHI'] || '';
    const lat = parseFloat(row['STATION_LATITUDE'] || 0);
    const lng = parseFloat(row['STATION_LONGITUDE'] || 0);

    if (stationId && name && !stopDb[stationId]) {
      stopDb[stationId] = {
        name,
        lat: isNaN(lat) ? 0 : lat,
        lng: isNaN(lng) ? 0 : lng,
      };
    }
  }

  // === 建立路線索引 ===
  // 格式: { stationId: [ [routeId, stationId, destination], ... ] }
  const routesIndex = {};

  for (const row of routeStopsRaw) {
    const routeId = row['ROUTE_ID'] || '';
    const stationId = row['STATION_ID'] || '';
    
    if (!routeId || !stationId) continue;

    if (!routesIndex[stationId]) {
      routesIndex[stationId] = [];
    }

    // 搵呢條路線嘅目的地
    const info = routeInfo[routeId];
    const destinations = info ? info.destinations : [''];
    const destination = destinations[0] || '';

    // 避免重複加入
    const alreadyExists = routesIndex[stationId].some(
      r => r[0] === routeId && r[2] === destination
    );

    if (!alreadyExists) {
      routesIndex[stationId].push([routeId, stationId, destination]);
    }
  }

  // === 建立車站列表（array 格式，方便搜尋） ===
  const stopsList = Object.entries(stopDb).map(([id, info]) => ({
    id,
    name: info.name,
    lat: info.lat,
    lng: info.lng,
  }));

  return { stops: stopsList, routes: routesIndex };
}

// ============================================
// 主程式
// ============================================

async function main() {
  console.log('🚌 港鐵巴士資料更新開始');
  console.log(`⏰ 時間: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
  console.log('');

  try {
    // 1. 下載兩個 CSV
    console.log('📥 下載官方資料...');
    
    const routesRaw = await downloadCSV(CSV_URLS.routes, '路線主表');
    console.log('');
    const routeStopsRaw = await downloadCSV(CSV_URLS.routeStops, '路線車站表');
    
    console.log('');
    console.log('📊 下載結果：');
    console.log(`   路線主表: ${routesRaw.length} 行`);
    console.log(`   路線車站表: ${routeStopsRaw.length} 行`);

    // 2. 轉換格式
    const { stops, routes } = transformData(routesRaw, routeStopsRaw);
    
    console.log('');
    console.log('📊 轉換結果：');
    console.log(`   獨立車站數: ${stops.length}`);
    console.log(`   有路線嘅車站數: ${Object.keys(routes).length}`);

    // 3. 寫入檔案
    console.log('');
    console.log('💾 儲存 JSON 檔案...');
    ensureDir(OUTPUT_DIR);

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'stops.json'),
      JSON.stringify(stops, null, 2)
    );
    console.log(`   ✅ stops.json (${stops.length} 個車站)`);

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'routes.json'),
      JSON.stringify(routes, null, 2)
    );
    console.log(`   ✅ routes.json (${Object.keys(routes).length} 個車站有路線)`);

    // 4. 版本資訊
    const version = {
      updated: new Date().toISOString(),
      updatedDisplay: new Date().toLocaleString('zh-HK', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      stopCount: stops.length,
      routeStationCount: Object.keys(routes).length,
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'version.json'),
      JSON.stringify(version, null, 2)
    );
    console.log(`   ✅ version.json`);

    console.log('');
    console.log('🎉 更新完成！');
  } catch (error) {
    console.error('');
    console.error('❌ 更新失敗:', error.message);
    if (error.response) {
      console.error('HTTP 狀態碼:', error.response.status);
    }
    process.exit(1);
  }
}

main();
