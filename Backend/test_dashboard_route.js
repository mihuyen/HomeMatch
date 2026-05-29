const db = require('./db');

async function test() {
    try {
        console.log('Testing admin dashboard queries...');
        
        // 1. Tinh Tong Doanh Thu
        const [revenueRows] = await db.query(
            `SELECT SUM(COALESCE(final_price, 0)) * 0.05 AS total_revenue 
             FROM submission_contracts 
             WHERE status IN ('signed', 'active', 'documents_submitted')`
        );
        const dbRevenue = Number(revenueRows[0]?.total_revenue || 0);
        const totalRevenue = dbRevenue;
        console.log('Revenue:', totalRevenue);

        // 2. Thong ke Nguoi dung moi
        const [userRows] = await db.query(
            `SELECT COUNT(*) AS count FROM users WHERE role IN ('owner', 'tenant', 'user')`
        );
        const dbUsers = Number(userRows[0]?.count || 0);
        const newUsers = dbUsers;
        console.log('Users:', newUsers);

        // 3. Ty le ky ket
        const [submissionCountRows] = await db.query('SELECT COUNT(*) AS count FROM property_submissions');
        const [contractCountRows] = await db.query('SELECT COUNT(*) AS count FROM submission_contracts');
        const subCount = Number(submissionCountRows[0]?.count || 0);
        const conCount = Number(contractCountRows[0]?.count || 0);
        const signingRate = subCount > 0 ? Math.round((conCount / subCount) * 1000) / 10 : 0;
        console.log('Signing Rate:', signingRate);

        // 4. Ky gui hoat dong
        const [activeSubRows] = await db.query(
            `SELECT COUNT(*) AS count FROM property_submissions WHERE status NOT IN ('cancelled', 'rejected')`
        );
        const dbActiveSubs = Number(activeSubRows[0]?.count || 0);
        const activeSubmissions = dbActiveSubs;
        console.log('Active Subs:', activeSubmissions);

        // 5. Tien do xu ly ky gui (status distribution)
        const [statusRows] = await db.query(
            `SELECT status, COUNT(*) AS count FROM property_submissions GROUP BY status`
        );
        
        let pendingSurvey = 0;
        let surveyed = 0;
        let contracted = 0;
        let listed = 0;
        let cancelled = 0;

        statusRows.forEach(row => {
            const s = String(row.status || '').toLowerCase();
            const count = Number(row.count || 0);
            if (['submitted', 'pending', 'assigned'].includes(s)) {
                pendingSurvey += count;
            } else if (s === 'surveyed') {
                surveyed += count;
            } else if (['documents_submitted', 'signed'].includes(s)) {
                contracted += count;
            } else if (['approved', 'listed'].includes(s)) {
                listed += count;
            } else if (['cancelled', 'rejected', 'expired'].includes(s)) {
                cancelled += count;
            }
        });
        console.log('Status Dist:', { pendingSurvey, surveyed, contracted, listed, cancelled });

        // 6. Hieu suat moi gioi
        const [salesRows] = await db.query(
            `SELECT 
                u.user_id, u.full_name, u.email,
                COUNT(DISTINCT ps.submission_id) AS assigned_count,
                COUNT(DISTINCT ap.appointment_id) AS appointments_count,
                COUNT(DISTINCT sc.submission_contract_id) AS contracts_count
             FROM users u
             LEFT JOIN property_submissions ps ON ps.assigned_sales_id = u.user_id
             LEFT JOIN appointments ap ON ap.submission_id = ps.submission_id AND ap.appointment_type = 'khảo sát'
             LEFT JOIN submission_contracts sc ON sc.submission_id = ps.submission_id AND sc.status = 'signed'
             WHERE u.role IN ('sale', 'agent')
             GROUP BY u.user_id`
        );

        let brokers = [];

        if (salesRows.length > 0) {
            brokers = salesRows.map(row => {
                const assigned = Number(row.assigned_count || 0);
                const contracts = Number(row.contracts_count || 0);
                const closingRate = assigned > 0 ? Math.round((contracts / assigned) * 100) : 0;
                return {
                    name: row.full_name,
                    role: 'Môi giới chuyên nghiệp',
                    assigned,
                    appointments: Number(row.appointments_count || 0),
                    contracts,
                    closingRate
                };
            });
        }
        console.log('Brokers count:', brokers.length);

        console.log('All tests passed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('Test failed with error:', e);
        process.exit(1);
    }
}

test();
