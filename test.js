const handler = require('./handler');

if (typeof handler.read === 'function') {
  handler.read(null, null, () => {
    console.log("✅ Callback completed.");
  });
} else {
  console.error("❌ handler.read is not a function.");
}
