import sqlite3

def setup_database():
    conn = sqlite3.connect("company_data.db")
    cursor = conn.cursor()

    # --- CLEAN START ---
    # Drop existing tables to update the schema
    cursor.execute('DROP TABLE IF EXISTS users')
    cursor.execute('DROP TABLE IF EXISTS products')
    cursor.execute('DROP TABLE IF EXISTS settings')

    # --- RECREATE TABLES ---
    # Table 1: Users
    cursor.execute('''CREATE TABLE users 
        (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER, department TEXT, salary INTEGER)''')

    # Table 2: Products (Now with manager_id)
    cursor.execute('''CREATE TABLE products 
        (id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT, price REAL, stock INTEGER, manager_id INTEGER)''')

    # Table 3: Personal Settings
    cursor.execute('''CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)''')

    # --- INSERT DATA ---
    cursor.executemany('INSERT INTO users (id, name, age, department, salary) VALUES (?, ?, ?, ?, ?)', 
        [(1, "Alice", 30, "Sales", 50000), (2, "Bob", 45, "Engineering", 70000)])

    cursor.executemany('INSERT INTO products (product_name, price, stock, manager_id) VALUES (?, ?, ?, ?)', 
        [("Laptop", 1200.0, 5, 2), ("Mouse", 25.0, 50, 1)])

    cursor.executemany('INSERT INTO settings (key, value) VALUES (?, ?)', 
        [("user_name", "Gemini User"), ("my_user_id", "2")])

    conn.commit()
    conn.close()
    print("✅ Relational Database Recreated Successfully!")

if __name__ == "__main__":
    setup_database()