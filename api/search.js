const { Client } = require('@notionhq/client');

module.exports = async (req, res) => {
  // 僅允許 GET 請求
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { nickname } = req.query;
    const databaseId = process.env.DATABASE_ID; // 訂單 B 表
    const notionToken = process.env.NOTION_TOKEN;
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID; // C 表 (款式細項)

    // 檢查環境變數
    if (!databaseId || !notionToken) {
      return res.status(500).json({ error: '伺服器未設定 Notion 環境變數 (DATABASE_ID 或 NOTION_TOKEN)' });
    }

    // 檢查查詢參數
    if (!nickname) {
      return res.status(400).json({ error: '缺少查詢參數：nickname' });
    }

    const notion = new Client({ auth: notionToken });

    // 🌟 1. 讀取 C 表 (款式細項表)，直接建立圖片對應字典 (用 商品名稱 + 規格)
    let imageMap = {};

    if (productDetailDbId) {
      try {
        const cRes = await notion.databases.query({ database_id: productDetailDbId });
        cRes.results.forEach(page => {
          const p = page.properties;
          
          // 取得 C 表的款式名稱
          const titleProp = p['款式名稱'] || p['名稱'] || p['Name'];
          const styleName = titleProp?.title?.[0]?.plain_text || titleProp?.rich_text?.[0]?.plain_text || '標準款式';

          // 取得 C 表的商品名稱 (可能是文字或關聯)
          let parentName = '';
          const prodProp = p['商品名稱'] || p['商品'];
          if (prodProp) {
            if (prodProp.type === 'select') parentName = prodProp.select?.name || '';
            else if (prodProp.type === 'rich_text') parentName = prodProp.rich_text?.[0]?.plain_text || '';
            else if (prodProp.type === 'title') parentName = prodProp.title?.[0]?.plain_text || '';
            else if (prodProp.type === 'relation' && prodProp.relation.length > 0) {
              // 如果是 relation，可以透過額外對應或暫不處理，這裡主要抓文字
            }
          }

          // 取得圖片網址
          const imgProp = p['款式圖片'] || p['圖片'] || p['Files'];
          let imageUrl = '';
          if (imgProp?.files?.[0]) {
            const fileObj = imgProp.files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }

          if (imageUrl) {
            if (parentName) {
              imageMap[`${parentName}_${styleName}`] = imageUrl;
            }
            imageMap[styleName] = imageUrl; // 備用
          }
        });
      } catch (e) {
        console.log('查詢 C 表失敗:', e.message);
      }
    }

    // 2. 取得資料庫結構，自動尋找型態為 'title'（標題）的欄位
    const dbInfo = await notion.databases.retrieve({ database_id: databaseId });
    const propsSchema = dbInfo.properties;

    const titlePropKey = Object.keys(propsSchema).find(
      k => propsSchema[k].type === 'title'
    );

    if (!titlePropKey) {
      return res.status(500).json({ error: 'Notion 資料庫中找不到 Title（標題）型態的欄位作為搜尋依據' });
    }

    // 3. 查詢 Notion 訂單資料庫
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: titlePropKey,
        title: {
          equals: nickname.trim()
        }
      }
    });

    // 4. 格式化回傳給前端的資料結構
    const results = response.results.map(page => {
      const p = page.properties;

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

      const productVal = getVal(['商品名稱', '商品', '品項']) || '';
      const specVal = getVal(['規格', '款式', 'Spec']) || '';

      const combinedSpec = [productVal, specVal]
        .filter(Boolean)
        .join(' + ');
      
      const qty = Number(getVal(['數量', '購買數量', 'Quantity'])) || 1;
      const unitPrice = Number(getVal(['單價', '價格', 'Price'])) || 0;
      const totalPrice = Number(getVal(['總價', '金額', 'Total', '總金額'])) || (unitPrice * qty);
      
      // 🌟 從 imageMap 中找出對應的圖片
      let imageUrl = '';
      if (productVal && specVal && imageMap[`${productVal}_${specVal}`]) {
        imageUrl = imageMap[`${productVal}_${specVal}`];
      } else if (specVal && imageMap[specVal]) {
        imageUrl = imageMap[specVal];
      }

      return {
        product: productVal,
        spec: combinedSpec || '未命名商品',
        delivery: getVal(['取貨方式', '寄送方式', '物流', 'Delivery']) || '未指定',
        quantity: qty,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        status: getVal(['狀態', '訂單狀態', 'Status']) || '待處理',
        imageUrl: imageUrl // 🌟 回傳抓到的圖片網址
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
