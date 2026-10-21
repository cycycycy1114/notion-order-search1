export default async function handler(req, res) {
  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: '請提供暱稱' });

  const NOTION_TOKEN = process.env.NOTION_TOKEN; // 存在 Vercel 後台的秘密變數
  const DATABASE_ID = process.env.DATABASE_ID;   // 存在 Vercel 後台的秘密變數

  try {
    const notionRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          property: 'LINE 暱稱',
          rich_text: { equals: nickname }
        }
      })
    });

    const data = await notionRes.json();
    const results = data.results.map(page => ({
      spec: page.properties['購買商品規格']?.select?.name || page.properties['購買商品規格']?.rich_text[0]?.plain_text || '無',
      delivery: page.properties['取貨方式']?.select?.name || '無',
      quantity: page.properties['數量']?.number || 1,
      status: page.properties['訂單狀態']?.select?.name || '處理中'
    }));

    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
