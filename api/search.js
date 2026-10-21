const { Client } = require('@notionhq/client');

module.exports = async (req, res) => {
  // 僅允許 GET 請求
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { nickname } = req.query;
    const databaseId = process.env.DATABASE_ID;
    const notionToken = process.env.NOTION_TOKEN;

    // 檢查環境變數
    if (!databaseId || !notionToken) {
      return res.status(500).json({ error: '伺服器未設定 Notion 環境變數 (DATABASE_ID 或 NOTION_TOKEN)' });
    }

    // 檢查查詢參數
    if (!nickname) {
      return res.status(400).json({ error: '缺少查詢參數：nickname' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 取得資料庫結構，自動尋找型態為 'title'（標題）的欄位
    const dbInfo = await notion.databases.retrieve({ database_id: databaseId });
    const propsSchema = dbInfo.properties;

    const titlePropKey = Object.keys(propsSchema).find(
      k => propsSchema[k].type === 'title'
    );

    if (!titlePropKey) {
      return res.status(500).json({ error: 'Notion 資料庫中找不到 Title（標題）型態的欄位作為搜尋依據' });
    }

    // 2. 查詢 Notion 資料庫
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: titlePropKey,
        title: {
          equals: nickname.trim()
        }
      }
    });

    // 3. 格式化回傳給前端的資料結構
    const results = response.results.map(page => {
      const p = page.properties;

      // 輔助函式：安全讀取 Notion 各種型態的欄位值
      const getVal = (possibleNames) => {
        const key = Object.keys(p).find(k => possibleNames.some(pn => k.trim().toLowerCase() === pn.trim().toLowerCase()));
        if (!key || !p[key]) return '';
        const prop = p[key];
        if (prop.type === 'title') return prop.title[0]?.plain_text || '';
        if (prop.type === 'rich_text') return prop.rich_text[0]?.plain_text || '';
        if (prop.type === 'select') return prop.select?.name || '';
        if (prop.type === 'status') return prop.status?.name || '';
        if (prop.type === 'number') return prop.number || 0;
        return '';
      };

      // 👇 【加在這裡】在這裡先讀取你想組合成規格的多個欄位
      const productVal = getVal(['商品名稱', '商品', '品項']) || '';
      const specVal = getVal(['規格', '款式', 'Spec']) || '';

      // 把有內容的欄位用 " + " 連接起來（例如：衣服 + 黑色L號）
      const combinedSpec = [productVal, specVal]
        .filter(Boolean) // 自動過濾掉空白的欄位
        .join(' + ');
      
      return {
        spec: combinedSpec || '未命名商品', // 👈 把組合好的變數放進這裡
        delivery: getVal(['取貨方式', '寄送方式', '物流', 'Delivery']) || '未指定',
        quantity: getVal(['數量', '購買數量', 'Quantity']) || 1,
        price: getVal(['金額', '價格', '總價', 'Price', 'Total']) || 0,
        status: getVal(['狀態', '訂單狀態', 'Status']) || '待處理'
      };
    });

    return res.status(200).json(results);

  } catch (error) {
    console.error("Notion Search Error:", error);
    return res.status(500).json({ 
      error: "伺服器內部錯誤", 
      details: error.message || String(error) 
    });
  }
};
