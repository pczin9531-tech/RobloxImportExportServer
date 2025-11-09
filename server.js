// ===================================================
// SERVIDOR ROBLOX IMPORT/EXPORT - VERSÃO MOBILE
// ===================================================

const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ===================================================
// CONFIGURAÇÕES
// ===================================================

app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use(limiter);

// ===================================================
// ARMAZENAMENTO DE API KEYS (30 minutos)
// ===================================================

const apiKeys = new Map();

// Limpa keys expiradas a cada 5 minutos
setInterval(() => {
    const now = Date.now();
    for (const [hash, data] of apiKeys.entries()) {
        if (now > data.expiresAt) {
            apiKeys.delete(hash);
        }
    }
}, 5 * 60 * 1000);

function hashKey(key) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(key).digest('hex');
}

function storeKey(apiKey) {
    const hash = hashKey(apiKey);
    apiKeys.set(hash, {
        key: apiKey,
        expiresAt: Date.now() + (30 * 60 * 1000)
    });
    return hash;
}

function getKey(apiKey) {
    const hash = hashKey(apiKey);
    const data = apiKeys.get(hash);
    if (!data || Date.now() > data.expiresAt) {
        apiKeys.delete(hash);
        return null;
    }
    return data.key;
}

// ===================================================
// FUNÇÕES DE CONVERSÃO
// ===================================================

function createRBXMX(jsonData) {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    
    let xml = '<roblox version="4">\n';
    
    if (data.objects && Array.isArray(data.objects)) {
        for (const obj of data.objects) {
            xml += objectToXML(obj, 1);
        }
    }
    
    xml += '</roblox>';
    return xml;
}

function objectToXML(obj, indent = 0) {
    const tabs = '  '.repeat(indent);
    let xml = `${tabs}<Item class="${escapeXML(obj.ClassName)}">\n`;
    
    xml += `${tabs}  <Properties>\n`;
    xml += `${tabs}    <string name="Name">${escapeXML(obj.Name)}</string>\n`;
    
    for (const [propName, propValue] of Object.entries(obj.Properties || {})) {
        xml += propertyToXML(propName, propValue, indent + 2);
    }
    
    xml += `${tabs}  </Properties>\n`;
    
    if (obj.Children && obj.Children.length > 0) {
        for (const child of obj.Children) {
            xml += objectToXML(child, indent + 1);
        }
    }
    
    xml += `${tabs}</Item>\n`;
    return xml;
}

function propertyToXML(name, value, indent) {
    const tabs = '  '.repeat(indent);
    
    if (!value || typeof value !== 'object') {
        return `${tabs}<string name="${escapeXML(name)}">${escapeXML(String(value))}</string>\n`;
    }
    
    const type = value.type;
    
    switch (type) {
        case 'Vector3':
            return `${tabs}<Vector3 name="${escapeXML(name)}">\n` +
                   `${tabs}  <X>${value.x || 0}</X>\n` +
                   `${tabs}  <Y>${value.y || 0}</Y>\n` +
                   `${tabs}  <Z>${value.z || 0}</Z>\n` +
                   `${tabs}</Vector3>\n`;
        
        case 'CFrame':
            const c = value.components || [0,0,0,1,0,0,0,1,0,0,0,1];
            return `${tabs}<CoordinateFrame name="${escapeXML(name)}">\n` +
                   `${tabs}  <X>${c[0]}</X><Y>${c[1]}</Y><Z>${c[2]}</Z>\n` +
                   `${tabs}  <R00>${c[3]}</R00><R01>${c[4]}</R01><R02>${c[5]}</R02>\n` +
                   `${tabs}  <R10>${c[6]}</R10><R11>${c[7]}</R11><R12>${c[8]}</R12>\n` +
                   `${tabs}  <R20>${c[9]}</R20><R21>${c[10]}</R21><R22>${c[11]}</R22>\n` +
                   `${tabs}</CoordinateFrame>\n`;
        
        case 'Color3':
            return `${tabs}<Color3 name="${escapeXML(name)}">\n` +
                   `${tabs}  <R>${value.r || 0}</R>\n` +
                   `${tabs}  <G>${value.g || 0}</G>\n` +
                   `${tabs}  <B>${value.b || 0}</B>\n` +
                   `${tabs}</Color3>\n`;
        
        default:
            return `${tabs}<string name="${escapeXML(name)}">${escapeXML(String(value.value || ''))}</string>\n`;
    }
}

function escapeXML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ===================================================
// FUNÇÕES ROBLOX API
// ===================================================

async function uploadToRoblox(apiKey, fileBuffer, assetType, name, description) {
    try {
        const form = new FormData();
        form.append('file', fileBuffer, { filename: `${name}.rbxm` });
        
        const response = await axios.post(
            'https://data.roblox.com/Data/Upload.ashx',
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Cookie': `.ROBLOSECURITY=${apiKey}`
                },
                params: {
                    assetType: assetType,
                    name: name,
                    description: description || '',
                    genreTypeId: 1
                }
            }
        );
        
        return { success: true, assetId: response.data };
    } catch (error) {
        console.error('Erro upload Roblox:', error.message);
        return { success: false, error: error.message };
    }
}

// ===================================================
// ROTAS
// ===================================================

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'Roblox Import/Export Server',
        version: '1.0.0',
        activeKeys: apiKeys.size,
        uptime: process.uptime()
    });
});

// Deletar API Key
app.post('/api/key/delete', (req, res) => {
    try {
        const { key } = req.body;
        if (!key) {
            return res.status(400).json({ success: false, error: 'Key não fornecida' });
        }
        
        const hash = hashKey(key);
        const deleted = apiKeys.delete(hash);
        
        res.json({ success: true, deleted });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Exportar
app.post('/api/export', async (req, res) => {
    try {
        const { apiKey, data, format, name, description, publishToMarketplace, assetType } = req.body;
        
        if (!apiKey || !data) {
            return res.status(400).json({ success: false, error: 'Dados incompletos' });
        }
        
        const validKey = getKey(apiKey);
        if (!validKey) {
            return res.status(401).json({ success: false, error: 'API key inválida' });
        }
        
        storeKey(apiKey);
        
        const fileBuffer = Buffer.from(createRBXMX(data));
        const fileName = `${name || 'export'}.${format || 'rbxmx'}`;
        
        const result = {
            success: true,
            downloadUrl: `${req.protocol}://${req.get('host')}/download/${fileName}`,
            filePath: `/storage/emulated/0/Download/${fileName}`,
            fileName,
            fileData: fileBuffer.toString('base64')
        };
        
        if (publishToMarketplace) {
            const uploadResult = await uploadToRoblox(
                validKey,
                fileBuffer,
                assetType || 'Model',
                name,
                description
            );
            
            if (uploadResult.success) {
                result.assetId = uploadResult.assetId;
                result.marketplaceUrl = `https://www.roblox.com/library/${uploadResult.assetId}`;
            } else {
                result.publishError = uploadResult.error;
            }
        }
        
        res.json(result);
        
    } catch (error) {
        console.error('Erro na exportação:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Importar
app.post('/api/import', async (req, res) => {
    try {
        const { apiKey, source, sourceValue, format } = req.body;
        
        if (!apiKey || !source || !sourceValue) {
            return res.status(400).json({ success: false, error: 'Dados incompletos' });
        }
        
        const validKey = getKey(apiKey);
        if (!validKey) {
            return res.status(401).json({ success: false, error: 'API key inválida' });
        }
        
        let fileBuffer;
        
        if (source === 'url') {
            const response = await axios.get(sourceValue, { responseType: 'arraybuffer' });
            fileBuffer = Buffer.from(response.data);
        } else if (source === 'assetId') {
            const response = await axios.get(
                `https://assetdelivery.roblox.com/v1/asset/?id=${sourceValue}`,
                { responseType: 'arraybuffer' }
            );
            fileBuffer = Buffer.from(response.data);
        } else if (source === 'file') {
            fileBuffer = Buffer.from(sourceValue, 'base64');
        }
        
        res.json({
            success: true,
            data: fileBuffer.toString('base64'),
            format: format || 'rbxm',
            message: 'Importação processada'
        });
        
    } catch (error) {
        console.error('Erro na importação:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================================
// INICIAR SERVIDOR
// ===================================================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  ROBLOX IMPORT/EXPORT SERVER          ║
║  Status: ✅ ONLINE                     ║
║  Porta: ${PORT}                        ║
╚════════════════════════════════════════╝
    `);
});

// Tratamento de erros
process.on('unhandledRejection', (error) => {
    console.error('❌ Erro:', error);
});
