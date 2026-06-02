const http = require('http');

const options = {
    hostname: 'localhost',
    port: 5050,
    path: '/api/admin/assignments?status=pending',
    method: 'GET',
    headers: {
        'Content-Type': 'application/json'
    }
};

// Disable require login check or pass a valid admin token. Since we are querying locally, let's bypass auth if we run it as a test or login first.
// Wait, we can just use the auth token of 'admin@homematch.com'!
// Let's first log in and get the token.
const loginData = JSON.stringify({
    email: 'admin@homematch.com',
    password: 'admin123'
});

const loginOptions = {
    hostname: 'localhost',
    port: 5050,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
    }
};

const reqLogin = http.request(loginOptions, (resLogin) => {
    let body = '';
    resLogin.on('data', chunk => body += chunk);
    resLogin.on('end', () => {
        try {
            const data = JSON.parse(body);
            const token = data.token;
            console.log('LOGGED IN! Token:', token);

            // Now query assignments
            const opt = {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': `Bearer ${token}`
                }
            };
            const req = http.request(opt, (res) => {
                let resBody = '';
                res.on('data', chunk => resBody += chunk);
                res.on('end', () => {
                    console.log('ASSIGNMENTS BODY:', resBody);
                    process.exit(0);
                });
            });
            req.end();
        } catch (e) {
            console.error('Login parsing failed:', body);
            process.exit(1);
        }
    });
});

reqLogin.write(loginData);
reqLogin.end();
