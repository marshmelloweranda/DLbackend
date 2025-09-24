const db = require('../config/database');

class User {
    // Create users table if not exists
    static async createTable() {
        const query = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nic VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(50),
      date_of_birth DATE,
      address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
        await db.query(query);
        console.log('Users table created/verified');
    }

    // Create licence categories table
    static async createLicenceCategoriesTable() {
        const query = `
      CREATE TABLE IF NOT EXISTS licence_categories (
        id SERIAL PRIMARY KEY,
        category_code VARCHAR(10) UNIQUE NOT NULL,
        category_label VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        fee DECIMAL(10,2) NOT NULL,
        min_age INTEGER DEFAULT 18,
        vehicle_type VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
        await db.query(query);
        console.log('Licence categories table created/verified');
    }

    // Create user sessions table
    static async createSessionsTable() {
        const query = `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        session_id VARCHAR(255) UNIQUE NOT NULL,
        access_token TEXT,
        token_type VARCHAR(50),
        expires_in INTEGER,
        scope TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
        await db.query(query);
        console.log('User sessions table created/verified');
    }

    // Create applications table
    static async createApplicationsTable() {
        const query = `
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        application_id VARCHAR(100) UNIQUE NOT NULL,
        medical_certificate_id VARCHAR(100),
        selected_categories JSONB,
        total_amount DECIMAL(10,2),
        payment_reference_id VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
        await db.query(query);
        console.log('Applications table created/verified');
    }

    // Seed default licence categories
    static async seedLicenceCategories() {
        const categories = [
            {
                category_code: 'A1',
                category_label: 'A1',
                description: 'Light Motor Cycle (up to 125cc)',
                fee: 1500.00,
                min_age: 18,
                vehicle_type: 'Motorcycle'
            },
            {
                category_code: 'A',
                category_label: 'A',
                description: 'Motor Cycle (above 125cc)',
                fee: 1500.00,
                min_age: 18,
                vehicle_type: 'Motorcycle'
            },
            {
                category_code: 'B1',
                category_label: 'B1',
                description: 'Motor Tricycle',
                fee: 2000.00,
                min_age: 18,
                vehicle_type: 'Three-wheeler'
            },
            {
                category_code: 'B',
                category_label: 'B',
                description: 'Light Motor Car (up to 3500 kg)',
                fee: 2500.00,
                min_age: 18,
                vehicle_type: 'Light Vehicle'
            },
            {
                category_code: 'C1',
                category_label: 'C1',
                description: 'Light Motor Lorry (3500 kg to 7500 kg)',
                fee: 3000.00,
                min_age: 21,
                vehicle_type: 'Medium Vehicle'
            },
            {
                category_code: 'C',
                category_label: 'C',
                description: 'Heavy Motor Lorry (above 7500 kg)',
                fee: 3500.00,
                min_age: 25,
                vehicle_type: 'Heavy Vehicle'
            },
            {
                category_code: 'D1',
                category_label: 'D1',
                description: 'Mini Bus (up to 16 passengers)',
                fee: 4000.00,
                min_age: 21,
                vehicle_type: 'Passenger Vehicle'
            },
            {
                category_code: 'D',
                category_label: 'D',
                description: 'Heavy Bus (above 16 passengers)',
                fee: 4500.00,
                min_age: 25,
                vehicle_type: 'Passenger Vehicle'
            }
        ];

        for (const category of categories) {
            const query = `
        INSERT INTO licence_categories (category_code, category_label, description, fee, min_age, vehicle_type) 
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (category_code) 
        DO UPDATE SET 
          category_label = EXCLUDED.category_label,
          description = EXCLUDED.description,
          fee = EXCLUDED.fee,
          min_age = EXCLUDED.min_age,
          vehicle_type = EXCLUDED.vehicle_type,
          updated_at = CURRENT_TIMESTAMP
      `;

            const values = [
                category.category_code,
                category.category_label,
                category.description,
                category.fee,
                category.min_age,
                category.vehicle_type
            ];

            await db.query(query, values);
        }
        console.log('Licence categories seeded successfully');
    }

    // Initialize all tables
    static async initTables() {
        await this.createTable();
        await this.createLicenceCategoriesTable();
        await this.createSessionsTable();
        await this.createApplicationsTable();
        await this.seedLicenceCategories();
    }

    // Save or update user
    static async saveUser(userData) {
        const { nic, name, email, phone, date_of_birth, address } = userData;

        const query = `
      INSERT INTO users (nic, name, email, phone, date_of_birth, address) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      ON CONFLICT (nic) 
      DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        date_of_birth = EXCLUDED.date_of_birth,
        address = EXCLUDED.address,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

        const values = [nic, name, email, phone, date_of_birth, address];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    // Get all active licence categories
    static async getLicenceCategories() {
        const query = `
      SELECT 
        category_code as id,
        category_label as label,
        description,
        fee,
        min_age,
        vehicle_type
      FROM licence_categories 
      WHERE is_active = true 
      ORDER BY category_code
    `;
        const result = await db.query(query);
        return result.rows;
    }

    // Get licence category by code
    static async getLicenceCategoryByCode(categoryCode) {
        const query = `
      SELECT * FROM licence_categories 
      WHERE category_code = $1 AND is_active = true
    `;
        const result = await db.query(query, [categoryCode]);
        return result.rows[0];
    }

    // Add new licence category
    static async addLicenceCategory(categoryData) {
        const { category_code, category_label, description, fee, min_age, vehicle_type } = categoryData;

        const query = `
      INSERT INTO licence_categories (category_code, category_label, description, fee, min_age, vehicle_type) 
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

        const values = [category_code, category_label, description, fee, min_age, vehicle_type];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    // Update licence category
    static async updateLicenceCategory(categoryCode, categoryData) {
        const { category_label, description, fee, min_age, vehicle_type, is_active } = categoryData;

        const query = `
      UPDATE licence_categories 
      SET category_label = $1, description = $2, fee = $3, min_age = $4, vehicle_type = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
      WHERE category_code = $7
      RETURNING *
    `;

        const values = [category_label, description, fee, min_age, vehicle_type, is_active, categoryCode];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    // Delete licence category (soft delete by setting is_active = false)
    static async deleteLicenceCategory(categoryCode) {
        const query = `
      UPDATE licence_categories 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE category_code = $1
      RETURNING *
    `;

        const result = await db.query(query, [categoryCode]);
        return result.rows[0];
    }

    // Save user session
    static async saveUserSession(userId, sessionData) {
        const { session_id, access_token, token_type, expires_in, scope } = sessionData;

        const query = `
      INSERT INTO user_sessions (user_id, session_id, access_token, token_type, expires_in, scope) 
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

        const values = [userId, session_id, access_token, token_type, expires_in, scope];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    // Save application
    static async saveApplication(applicationData) {
        const { user_id, application_id, medical_certificate_id, selected_categories, total_amount, payment_reference_id } = applicationData;

        const query = `
      INSERT INTO applications (user_id, application_id, medical_certificate_id, selected_categories, total_amount, payment_reference_id) 
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

        const values = [user_id, application_id, medical_certificate_id, selected_categories, total_amount, payment_reference_id];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    // Find user by NIC
    static async findByNIC(nic) {
        const query = 'SELECT * FROM users WHERE nic = $1';
        const result = await db.query(query, [nic]);
        return result.rows[0];
    }

    // Find application by ID
    static async findApplicationById(applicationId) {
        const query = `
      SELECT a.*, u.nic, u.name, u.email 
      FROM applications a 
      JOIN users u ON a.user_id = u.id 
      WHERE a.application_id = $1
    `;
        const result = await db.query(query, [applicationId]);
        return result.rows[0];
    }

    // Get user applications
    static async getUserApplications(nic) {
        const query = `
      SELECT a.* 
      FROM applications a 
      JOIN users u ON a.user_id = u.id 
      WHERE u.nic = $1 
      ORDER BY a.created_at DESC
    `;
        const result = await db.query(query, [nic]);
        return result.rows;
    }
}

module.exports = User;