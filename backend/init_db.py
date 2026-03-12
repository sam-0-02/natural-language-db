import sqlite3

def setup_database():
    # Connect to SQLite (this automatically creates 'company_data.db' in your backend folder)
    conn = sqlite3.connect("company_data.db")
    cursor = conn.cursor()

    # 1. Create a users table (The Schema)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            age INTEGER NOT NULL,
            department TEXT NOT NULL,
            salary INTEGER NOT NULL
        )
    ''')

    # Clear old data just in case you run this script multiple times
    cursor.execute('DELETE FROM users')

    # 2. Prepare some dummy data
    dummy_employees = [
        ("Alice", 28, "Engineering", 85000),
        ("Bob", 35, "Sales", 60000),
        ("Charlie", 42, "Engineering", 110000),
        ("Diana", 24, "Marketing", 55000),
        ("Evan", 31, "HR", 65000)
    ]
    
    # 3. Insert the data into the database
    cursor.executemany('''
        INSERT INTO users (name, age, department, salary) 
        VALUES (?, ?, ?, ?)
    ''', dummy_employees)

    # Save changes and close the connection
    conn.commit()
    conn.close()
    
    print("✅ Database 'company_data.db' created and populated successfully!")

if __name__ == "__main__":
    setup_database()