import sqlite3

def setup_database():
    conn = sqlite3.connect("company_data.db")
    cursor = conn.cursor()

    # Table 1: Users
    cursor.execute('''CREATE TABLE IF NOT EXISTS users 
        (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER, department TEXT, salary INTEGER)''')

    # Table 2: Products (NEW)
    cursor.execute('''CREATE TABLE IF NOT EXISTS products 
        (id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT, price REAL, stock INTEGER)''')

    # Clear and Add Dummy Products
    cursor.execute('DELETE FROM products')
    cursor.executemany('INSERT INTO products (product_name, price, stock) VALUES (?, ?, ?)', 
        [("Laptop", 1200.0, 10), ("Mouse", 25.0, 50), ("Monitor", 300.0, 15)])

    conn.commit()
    conn.close()
    print("✅ Multi-table database ready!")

if __name__ == "__main__":
    setup_database()