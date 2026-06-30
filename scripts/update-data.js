const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

// ============================================
// 設定
// ============================================

const CSV_URLS = {
  routes: 'https://opendata.mtr.com.hk/data/mtr_bus_routes.csv',
  stops: 'https://opendata.mtr.com.hk/data/mtr_bus_stops.csv',
};

const OUTPUT_DIR = path.join(__dirname, '..', 'data');

// ============================================
// 工具函數
// ============================================

async function downloadCSV(url) {
  console.log(`  📡 下載: ${url}`);
  const response = await axios.get(url, {
    responseType: 'text',
    timeout: 15000,
  });
  return parse(response.data, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================
// 資料轉換
// ============================================

function transformData(routesRaw, stopsRaw) {
  console.log('  🔄 轉換資料格式...');

  const stops = [];

  for (const row of stopsRaw) {
    const stopId = row.stop_id || row.stopId || '';
    const name = row.name_tc || row.nameTc || row.stop_name || '';
    const lat = parseFloat(row.latitude || row.lat || 0);
    const lng = parseFloat(row.longitude || row.lng || row.lon || 0);

    if (stopId && name) {
      stops.push({
        id: stopId,
        name: name,
        lat: lat,
        lng: lng,
      });
    }
  }

  const routes = {};

  for (const row of routesRaw) {
    const stopId = row.stop_id || row.stopId || '';
    const routeNo = row.route_no || row.routeNo || row.route || '';
    const destination = row.dest_tc || row.destTc || row.destination || '';

    if (stopId && routeNo) {
      if (!routes[stopId]) {
        routes[stopId] = [];
      }
      routes[stopId].push([routeNo, stopId, destination]);
    }
  }

  return { stops, routes };
}

// ============================================
// 主程式
// ============================================

async function main() {
  console.log('🚌 港鐵巴士資料更新開始');
  console.log(`⏰ 時間: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
  console.log('');

  try {
    console.log('📥 下載官方資料...');
    const [routesRaw, stopsRaw] = await Promise.all([
      downloadCSV(CSV_URLS.routes),
      downloadCSV(CSV_URLS.stops),
    ]);
    console.log(`   ✅ 路線 CSV: ${routesRaw.length} 行`);
    console.log(`   ✅ 車站 CSV: ${stopsRaw.length} 行`);

    const { stops, routes } = transformData(routesRaw, stopsRaw);
    console.log(`   ✅ 車站數: ${stops.length}`);
    console.log(`   ✅ 路線覆蓋車站: ${Object.keys(routes).length}`);

    console.log('');
    console.log('💾 儲存 JSON 檔案...');
    ensureDir(OUTPUT_DIR);

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'stops.json'),
      JSON.stringify(stops, null, 2)
    );
    console.log('   ✅ data/stops.json');

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'routes.json'),
      JSON.stringify(routes, null, 2)
    );
    console.log('   ✅ data/routes.json');

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
    console.log('   ✅ data/version.json');

    console.log('');
    console.log('🎉 更新完成！');
    console.log(`📊 總共 ${stops.length} 個車站，${Object.keys(routes).length} 個車站有路線資料`);
  } catch (error) {
    console.error('');
    console.error('❌ 更新失敗:', error.message);
    if (error.response) {
      console.error('   HTTP 狀態碼:', error.response.status);
    }
    process.exit(1);
  }
}

main();
