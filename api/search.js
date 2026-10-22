const { Client } = require('@notionhq/client');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { nickname } = req.query;
    const databaseId = process.env.DATABASE_ID; // 訂單 B 表
    const notionToken = process.env.NOTION_TOKEN;
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID; // C 表 (款式細項)
    const productDbId = process.env.PRODUCT_DB_ID; // A 表 (主商品表，用於解析 C 表的關聯)

    if (!databaseId || !notionToken) {
      return res.status(500).json({ error: '伺服器未設定 Notion 環境變數' });
    }

    if (!nickname) {
      return res.status(400).json({ error: '缺少查詢參數：nickname' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 先建立 A 表的對照字典 (ID -> 商品名稱)，以便精準解析 C 表的關聯
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties;
          const nameProp = p['商品名稱'] || p['名稱'] || p['Name'];
          const name = nameProp?.title?.[0]?.plain_text || nameProp?.rich_text?.[0]?.plain_text || '';
          if (name) aMapById[page.id] = name;
        });
      } catch (e) {
        console.log('查詢 A 表失敗:', e.message);
      }
    }

    // 2. 讀取 C 表 (款式細項表)，嚴格建立「商品名稱_款式名稱」的圖片對應字典
    let imageMap = {};

    if (productDetailDbId) {
      try {
        const cRes = await notion.databases.query({ database_id: productDetailDbId });
        cRes.results.forEach(page => {
          const p = page.properties;
          
          // 取得 C 表的款式名稱
          const titleProp = p['款式名稱'] || p['名稱'] || p['Name'];
          const styleName = titleProp?.title?.[0]?.plain_text || titleProp?.rich_text?.[0]?.plain_text || '標準款式';

          // 取得 C 表對應的商品名稱 (支援 Relation 或一般文字)
          let parentName = '';
          const prodProp = p['商品名稱'] || p['商品'];
          if (prodProp && prodProp.type === 'relation' && prodProp.relation.length > 0) {
            const relId = prodProp.relation[0].id;
            parentName = aMapById[relId] || '';
          } else if (prodProp) {
            if (prodProp.type === 'select') parentName = prodProp.select?.name || '';
            else if (prodProp.type === 'rich_text') parentName = prodProp.rich_text?.[0]?.plain_text || '';
            else if (prodProp.type === 'title') parentName = prodProp.title?.[0]?.plain_text || '';
          }

          // 取得圖片網址
          const imgProp = p['款式圖片'] || p['圖片'] || p['Files'];
          let imageUrl = '';
          if (imgProp?.files?.[0]) {
            const fileObj = imgProp.files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }

          // 🌟 嚴格對應：必須同時符合商品名稱與款式名稱，絕不互相覆蓋
          if (parentName && imageUrl) {
            imageMap[`${parentName}_${styleName}`] = imageUrl;
          }
        });
      } catch (e) {
        console.log('查詢 C 表失敗:', e.message);
      }
    }

    // 3. 取得訂單資料庫結構與資料
    const dbInfo = await notion.databases.retrieve({ database_id: databaseId });
    const propsSchema = dbInfo.properties;

    const titlePropKey = Object.keys(propsSchema).find(
      k => propsSchema[k].type === 'title'
    );

    if (!titlePropKey) {
      return res.status(500).json({ error: 'Notion 資料庫中找不到 Title 欄位' });
    }

    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: titlePropKey,
        title: {
          equals: nickname.trim()
        }
      }
    });

    // 4. 格式化回傳結果
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
      
      const qty = Number(getVal(['數量', '購買數量', 'Quantity'])) || 1;
      const unitPrice = Number(getVal(['單價', '價格', 'Price'])) || 0;
      const totalPrice = Number(getVal(['總價', '金額', 'Total', '總金額'])) || (unitPrice * qty);
      
      // 🌟 精準用「商品名稱_款式名稱」去抓取對應圖片
      let imageUrl = '';
      if (productVal && specVal && imageMap[`${productVal}_${specVal}`]) {
        imageUrl = imageMap[`${productVal}_${specVal}`];
      }

      return {
        product: productVal,
        spec: specVal || '標準款式',
        delivery: getVal(['取貨方式', '寄送方式', '物流', 'Delivery']) || '未指定',
        quantity: qty,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        status: getVal(['狀態', '訂單狀態', 'Status']) || '待處理',
        imageUrl: imageUrl
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
