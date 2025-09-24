const db = require('../config/database');

async function alterUserTable() {
  try {
    // Alter the NIC column to support longer values
    const alterQuery = `
      ALTER TABLE users 
      ALTER COLUMN nic TYPE VARCHAR(255);
    `;
    
    await db.query(alterQuery);
    console.log('Users table altered successfully - NIC column updated to VARCHAR(255)');
    
    // Also update other columns that might receive long values
    const alterEmailQuery = `
      ALTER TABLE users 
      ALTER COLUMN email TYPE VARCHAR(255);
    `;
    
    await db.query(alterEmailQuery);
    console.log('Users table altered successfully - Email column updated to VARCHAR(255)');
    
  } catch (error) {
    console.error('Error altering users table:', error);
  }
}

alterUserTable();