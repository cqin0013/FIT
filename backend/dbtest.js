// dbTest.js
const mysql = require('mysql2/promise');

async function testDBConnection() {
  try {
    const connection = await mysql.createConnection({
      host: 'city-data-mysql.cjk4ce8mi0r6.ap-southeast-2.rds.amazonaws.com',
      port: 3306,
      user: 'admin',
      password: 'Himanshu2000',
      database: 'city_data'
    });

    const [rows] = await connection.query('SELECT NOW() AS currentTime');
    console.log('✅ MySQL connection successful! Current time:', rows[0].currentTime);

    await connection.end();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
  }
}

testDBConnection();
