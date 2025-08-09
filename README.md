npm install

node test.js



npm install express

node server.js



npm install node-cron

npm install cors







first：

http://localhost:3000/api/parking





ac1.1

http://localhost:3000/api/metrics/car-ownership



ac1.2

http://localhost:3000/api/metrics/cbd-population



ac2.1

http://localhost:3000/api/parking?onlyAvailable=true\&near=-37.81,144.96\&radius=300

all（not ava）：

http://localhost:3000/api/parking?near=-37.81,144.96\&radius=300



ac2.2

http://localhost:3000/api/bays/62888



ac2.3

http://localhost:3000/api/bays/<bayId>/history?start=2025-08-01T00:00:00Z\&end=2025-08-02T23:59:59Z

all（all time）

http://localhost:3000/api/bays/62888/history











