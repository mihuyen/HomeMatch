const db = require('./db');

async function main() {
    try {
        const [schema] = await db.query("SHOW COLUMNS FROM survey_records LIKE 'image_checklist'");
        console.log("Schema:");
        console.log(schema);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
