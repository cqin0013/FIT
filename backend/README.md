npm install

node test.js



npm install express

node server.js



npm install node-cron

npm install cors



npm install mysql2 node-fetch
npm i mysql2 node-fetch cron

http://localhost:3000/dashboard





http://localhost:3000/api/db-test

（可选）表结构：http://localhost:3000/api/db/describe

（可选）采样行：http://localhost:3000/api/db/sample/sensors?limit=5

（可选）历史范围：http://localhost:3000/api/db/raw-max


AC 1.1 车辆/千人（Victoria）
默认区间：
http://localhost:3000/api/metrics/car-ownership

指定年份：
http://localhost:3000/api/metrics/car-ownership?from=2016&to=2021



AC 1.2 CBD 人口
默认：
http://localhost:3000/api/metrics/cbd-population

指定城市/区间：
http://localhost:3000/api/metrics/cbd-population?&from=2003&to=2021



AC 2.1 附近可用车位

http://localhost:3000/api/parking?onlyAvailable=true\&near=-37.81,144.96&radius=300

http://localhost:3000/api/parking?near=-37.81,144.96&radius=300




AC 2.2 指定 Bay（当前状态）

http://localhost:3000/api/bays/62888




ac2.3

http://localhost:3000/api/bays/<bayId>/history?start=2025-08-01T00:00:00Z\&end=2025-08-02T23:59:59Z

all（all time）

http://localhost:3000/api/bays/62888/history

（补充）AC 2.3 历史占用（如需）
指定时间窗：
http://localhost:3000/api/bays/62888/history?start=2025-08-12%2000:00:00&end=2025-08-13%2023:59:59

按整天：
http://localhost:3000/api/parking-history?date=2025-08-12
或
http://localhost:3000/api/parking-history?start=2025-08-12%2000:00:00&end=2025-08-12%2023:59:59&limit=20000




vishnu.allurihimavardhana@monash.edu

All good in backend

live-latest：/api/parking









