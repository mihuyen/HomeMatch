const http = require('https');

function search(query) {
    return new Promise((resolve, reject) => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=vi`;
        
        const options = {
            headers: {
                'User-Agent': 'HomeMatchApp/1.0 (contact@homematch.com)'
            }
        };

        http.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        }).on('error', (err) => { reject(err); });
    });
}

async function test() {
    console.log("Searching: 'hà cầu hà đông hà nội'...");
    const res1 = await search("hà cầu hà đông hà nội");
    console.log("Res1:", res1.body);

    console.log("\nSearching: 'hà đông hà nội'...");
    const res2 = await search("hà đông hà nội");
    console.log("Res2:", res2.body);
}

test();
