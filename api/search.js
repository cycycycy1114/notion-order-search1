const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const dbId = process.env.DATABASE_ID;
    if (!dbId) {
      return res.status(400).json({ error: '缺少 DATABASE_ID 環境變數' });
    }

    // 1. 測試能不能成功讀取資料庫結構
    const dbInfo = await notion.databases.retrieve({ database_id: dbId });
    
    // 2. 把 Notion 資料庫裡「實際存在的欄位名稱與型態」列出來
    const actualProperties = Object.keys(dbInfo.properties).map(key => ({
      name: key,
      type: dbInfo.properties[key].type
    }));

    // 3. 測試能不能成功查詢資料庫的前幾筆資料
    const response = await notion.databases.query({
      database_id: dbId,
      page_size: 5
    });

    // 成功！把 Notion 實際的欄位清單回傳給前端顯示
    return res.status(200).json({
      message: "連線成功！以下是您的 Notion 資料庫實際欄位：",
      databaseColumns: actualProperties,
      sampleDataCount: response.results.length
    });

  } catch (error) {
    // 如果這裡報錯，就能精準知道是 Notion Token 錯、資料庫 ID 錯、還是權限不足
    console.error("Debug Error:", error);
    return res.status(500).json({ 
      error: "除錯失敗", 
      details: error.body ? error.body : error.message 
    });
  }
};
