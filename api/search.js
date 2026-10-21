const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { nickname } = req.query;
    const dbId = process.env.DATABASE_ID;

    if (!dbId || !nickname) {
      return res.status(400).json({ error: '缺少參數' });
    }

    const dbInfo = await notion.databases.retrieve({ database_id: dbId });
    const propsSchema = dbInfo.properties;

    const namePropKey = Object.keys(propsSchema).find(k =>
      ['訂單', '訂單名稱', '暱稱', 'LINE社群暱稱', 'Name', 'Title'].some(p => k.trim().toLowerCase() === p.trim().toLowerCase())
    );

    if (!namePropKey) {
      return res.status(500).json({ error: 'Notion 資料庫中找不到對應的暱稱/標題欄位' });
    }

    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        property: namePropKey,
        title: {
          equals: nickname
        }
      }
    });

    const results = response.results.map(page => {
      const p = page.properties;
      const getVal = (key) => {
        const prop = p[key];
        if (!prop) return '';
        if (prop.type === 'title') return prop.title[0]?.plain_text || '';
        if (prop.type === 'rich_text') return prop.rich_text[0]?.plain_text || '';
        if (prop.type === 'select') return prop.select?.name || '';
        if (prop.type === 'status') return prop.status?.name || '';
        if (prop.type === 'number') return prop.number || 0;
        return '';
      };

      const findKey = (possibleNames) => Object.keys(p).find(k => possibleNames.some(pn => k.trim().toLowerCase() === pn.trim().toLowerCase()));

      return {
        spec: getVal(findKey(['規格', '款式', 'Spec', '商品名稱', '商品', '品項'])),
        delivery: getVal(findKey(['取貨方式', '寄送方式', '物流', 'Delivery'])),
        quantity: getVal(findKey(['數量', '購買數量', 'Quantity'])),
        status: getVal(findKey(['狀態', '訂單狀態', 'Status'])) || '待處理'
      };
    });

    res.status(200).json(results);
  } catch (error) {
    console.error("Search Error:", error.body || error.message);
    res.status(500).json({ error: error.body ? JSON.stringify(error.body) : error.message });
  }
};
