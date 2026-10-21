const { Client } = require('@notionhq/client');

module.exports = async (req, res) => {
  try {
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const dbId = process.env.DATABASE_ID;

    // 簡單測試連線
    const response = await notion.databases.retrieve({ database_id: dbId });
    
    return res.status(200).json({ success: true, name: response.title[0]?.plain_text || "DB" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
