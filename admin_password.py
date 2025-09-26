import mysql.connector
import bcrypt

# Database configuration
db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': '123456',
    'database': 'admin'
}

def update_admin_password():
    try:
        # Connect to database
        connection = mysql.connector.connect(**db_config)
        cursor = connection.cursor()
        
        # Generate correct hash for "admin123"
        password = "admin1234"
        hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(12))
        
        # Update the admin user
        cursor.execute(
            "UPDATE admin_users SET password_hash = %s WHERE username = 'admin'",
            (hashed_password,)
        )
        
        connection.commit()
        cursor.close()
        connection.close()
        
        print(f"✅ Admin password updated successfully!")
        print(f"Username: admin")
        print(f"Password: admin1234")
        print(f"New hash: {hashed_password.decode('utf-8')}")
        
    except Exception as e:
        print(f"❌ Error updating admin password: {e}")

# Run the function
update_admin_password()
