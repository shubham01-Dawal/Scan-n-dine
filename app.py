from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify, abort
from functools import wraps
import mysql.connector
from mysql.connector import Error
import bcrypt
from datetime import datetime
import os
import re

app = Flask(__name__)
app.secret_key = 'scan-n-dine-secret-key-2023'

# MySQL configuration
db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': '123456',
    'database': 'admin'
}

def create_db_connection():
    """Create a database connection"""
    try:
        print(f"Attempting to connect to MySQL database: {db_config['database']}")
        connection = mysql.connector.connect(**db_config)
        print("✅ Database connection established successfully")
        return connection
    except Error as e:
        print(f"❌ Error connecting to MySQL: {e}")
        return None

# Auth helpers
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('admin_logged_in'):
            return redirect(url_for('admin_html'))
        return f(*args, **kwargs)
    return decorated_function

def init_db():
    """Initialize the database and create tables if they don't exist"""
    try:
        print("\n" + "="*50)
        print("INITIALIZING DATABASE")
        print("="*50)

        temp_config = db_config.copy()
        temp_config.pop('database', None)

        connection = mysql.connector.connect(**temp_config)
        cursor = connection.cursor()
        print("✅ Connected to MySQL server")

        # Create database
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS {db_config['database']} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        cursor.execute(f"USE {db_config['database']}")
        print(f"✅ Database '{db_config['database']}' is ready")

        # Create tables
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS admin_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS menu_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                category_id INT,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                price DECIMAL(10, 2) NOT NULL,
                image_url VARCHAR(255),
                is_available BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_number VARCHAR(20) UNIQUE NOT NULL,
                table_number VARCHAR(10),
                customer_name VARCHAR(100),
                total_amount DECIMAL(10, 2) NOT NULL,
                discount_amount DECIMAL(10, 2) DEFAULT 0,
                final_amount DECIMAL(10, 2) NOT NULL,
                status ENUM('pending', 'preparing', 'completed', 'cancelled') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS order_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT,
                menu_item_id INT,
                item_name VARCHAR(100),
                quantity INT NOT NULL,
                price DECIMAL(10, 2) NOT NULL
            )
        ''')
        # Make sure item_name column exists even if the table was created previously without it (MySQL 8+)
        try:
            cursor.execute("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_name VARCHAR(100)")
        except Exception as _:
            # Older MySQL may not support IF NOT EXISTS. Try to detect column presence.
            try:
                cursor.execute("SHOW COLUMNS FROM order_items LIKE 'item_name'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE order_items ADD COLUMN item_name VARCHAR(100)")
            except Exception as __:
                pass

        # Customer Support Logs
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS support_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(150),
                message TEXT NOT NULL,
                status ENUM('open','in_progress','resolved') DEFAULT 'open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Create default admin if none exists
        cursor.execute("SELECT COUNT(*) FROM admin_users")
        count = cursor.fetchone()[0]

        if count == 0:
            print("Creating default admin user...")
            default_password = "admin123"
            hashed_password = bcrypt.hashpw(default_password.encode('utf-8'), bcrypt.gensalt())
            cursor.execute(
                "INSERT INTO admin_users (username, password_hash) VALUES (%s, %s)",
                ('admin', hashed_password)
            )
            print("✅ Default admin created: username=admin, password=admin123")

        connection.commit()
        cursor.close()
        connection.close()
        print("✅ Database initialization completed successfully")

    except Error as e:
        print(f"❌ Error initializing database: {e}")

def verify_admin(username, password):
    """Verify admin credentials"""
    try:
        connection = create_db_connection()
        if connection:
            cursor = connection.cursor(dictionary=True)
            cursor.execute("SELECT * FROM admin_users WHERE username = %s", (username,))
            admin = cursor.fetchone()

            cursor.close()
            connection.close()

            if admin:
                stored_hash = admin['password_hash']
                if isinstance(stored_hash, str):
                    stored_hash = stored_hash.encode('utf-8')

                if bcrypt.checkpw(password.encode('utf-8'), stored_hash):
                    return admin
            return None
    except Exception as e:
        print(f"❌ Error verifying admin: {e}")
        return None

# Routes
@app.route('/')
def home():
    return render_template('home.html')

# Compatibility routes to avoid 404/redirect loops from hardcoded links
@app.route('/home.html')
@app.route('/Home.html')
def home_compat():
    return redirect(url_for('home'))

# Serve the user index page explicitly for QR targets
@app.route('/index')
@app.route('/index.html')
def index_page():
    return render_template('index.html')

@app.route('/admin.html')
def admin_html_lower():
    return redirect(url_for('admin_html'))

@app.route('/Admin.html')
def admin_html():
    if session.get('admin_logged_in'):
        return redirect(url_for('admin_menu'))
    return render_template('Admin.html')

# =====================
# Public Order Creation API and helpers
# =====================
def generate_order_number():
    """Generate a short unique order number"""
    return f"SND{int(datetime.now().timestamp())}"

def calculate_discount(subtotal, code):
    """Calculate discount amount based on code.
    Mirrors the client-side supported codes to ensure server-side validation.
    """
    if not code:
        return 0.0
    code = str(code).upper().strip()
    codes = {
        "WEEKEND30": {"type": "percentage", "value": 30},
        "FIRST20": {"type": "percentage", "value": 20},
        "FAMILY25": {"type": "percentage", "value": 25},
        "STUDENT15": {"type": "percentage", "value": 15},
        "HAPPY40": {"type": "percentage", "value": 40},
    }
    rule = codes.get(code)
    if not rule:
        return 0.0
    if rule["type"] == "percentage":
        return float(subtotal) * (float(rule["value"]) / 100.0)
    return 0.0

# =====================
# Image URL Sanitization/Validation
# =====================
IMG_EXT = ('.jpg', '.jpeg', '.png')

def sanitize_image_url(raw: str):
    """Validate and sanitize an image source.
    Accepts:
    - http/https URLs ending with .jpg/.jpeg/.png (query/hash allowed)
    - local static paths like '/static/foo.jpg' or 'static/foo.png'

    Returns a safe URL string to store (e.g., '/static/foo.jpg' or the original http URL),
    or None if invalid.
    """
    if not raw:
        return None
    s = str(raw).strip()
    # Remote URL
    if s.lower().startswith(('http://', 'https://')):
        # Allow query/hash after extension
        match = re.search(r"\.(jpg|jpeg|png)(\?|#|$)", s, re.IGNORECASE)
        return s if match else None
    # Local/static path
    # Normalize to avoid path traversal and unify separators
    s = s.lstrip('/')  # remove leading slash if present
    # If user only provided a filename in static root
    if not s.lower().startswith('static/'):
        # Treat as placed in static root
        candidate = os.path.join('static', s)
    else:
        candidate = s
    # Normalize the candidate
    norm = os.path.normpath(candidate).replace('\\', '/')
    # Must remain under static/
    if not norm.lower().startswith('static/'):
        return None
    # Must have valid extension
    if not norm.lower().endswith(IMG_EXT):
        return None
    # Store as URL path
    return '/' + norm

@app.route('/api/orders', methods=['POST'])
def api_create_order():
    """Create a new order from the user side (no admin auth required)."""
    try:
        data = request.get_json(silent=True) or {}
        # Expected payload: {
        #   table_number: str|int,
        #   customer_name: str (optional),
        #   discount_code: str (optional),
        #   items: [{name: str, price: number, quantity: int}]
        # }
        items = data.get('items') or []
        if not items:
            return jsonify({'error': 'items are required'}), 400

        # Normalize and validate items
        normalized = []
        for it in items:
            try:
                name = (it.get('name') or '').strip()
                qty = int(it.get('quantity') or 0)
                price = float(it.get('price') or 0)
            except Exception:
                return jsonify({'error': 'invalid item values'}), 400
            if not name or qty <= 0 or price < 0:
                return jsonify({'error': 'invalid item'}), 400
            normalized.append({'name': name, 'quantity': qty, 'price': price})

        table_number = str(data.get('table_number') or '').strip() or None
        customer_name = (data.get('customer_name') or '').strip() or None
        discount_code = (data.get('discount_code') or '').strip() or None

        subtotal = sum(i['price'] * i['quantity'] for i in normalized)
        discount_amount = calculate_discount(subtotal, discount_code)
        final_amount = max(0.0, float(subtotal) - float(discount_amount))
        order_number = generate_order_number()

        conn = create_db_connection()
        if not conn:
            return jsonify({'error': 'db connection failed'}), 500
        cur = conn.cursor()

        # Insert order
        cur.execute(
            """
            INSERT INTO orders (order_number, table_number, customer_name, total_amount, discount_amount, final_amount, status, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, 'pending', %s)
            """,
            (order_number, table_number, customer_name, subtotal, discount_amount, final_amount, datetime.now())
        )
        order_id = cur.lastrowid

        # Insert order items with best-effort menu_item lookup by name
        for it in normalized:
            menu_item_id = None
            try:
                cur_lookup = conn.cursor()
                cur_lookup.execute("SELECT id FROM menu_items WHERE name=%s LIMIT 1", (it['name'],))
                row = cur_lookup.fetchone()
                if row:
                    menu_item_id = row[0]
                cur_lookup.close()
            except Exception:
                try:
                    cur_lookup.close()
                except Exception:
                    pass

            cur.execute(
                """
                INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (order_id, menu_item_id, it['name'], it['quantity'], it['price'])
            )

        conn.commit()
        cur.close(); conn.close()

        return jsonify({
            'id': order_id,
            'order_number': order_number,
            'table_number': table_number,
            'customer_name': customer_name,
            'total_amount': float(subtotal),
            'discount_amount': float(discount_amount),
            'final_amount': float(final_amount),
            'status': 'pending',
            'items': normalized
        }), 201
    except Exception as e:
        print('Error creating order:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/api/orders/<int:order_id>', methods=['DELETE'])
@login_required
def api_delete_order(order_id):
    """Delete an order and its associated items."""
    try:
        conn = create_db_connection()
        if not conn:
            return jsonify({'error': 'db connection failed'}), 500
        cur = conn.cursor()
        # Delete order items first, then the order
        cur.execute("DELETE FROM order_items WHERE order_id=%s", (order_id,))
        cur.execute("DELETE FROM orders WHERE id=%s", (order_id,))
        conn.commit()
        cur.close(); conn.close()
        return jsonify({'deleted': True})
    except Exception as e:
        print('Error deleting order:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/user')
def user():
    """Route for user button - opens scanner page"""
    return render_template('scanner.html')

@app.route('/scanner.html')
def scanner():
    """Alternative route for scanner page"""
    return render_template('scanner.html')

@app.route('/login', methods=['POST'])
def login():
    username = (request.form.get('username') or '').strip()
    password = (request.form.get('password') or '').strip()

    if not username or not password:
        flash('Username and password are required.', 'error')
        return redirect(url_for('admin_html'))

    admin = verify_admin(username, password)

    if admin:
        session['admin_logged_in'] = True
        session['admin_id'] = admin['id']
        session['admin_username'] = admin['username']
        return redirect(url_for('admin_menu'))
    else:
        flash('Invalid credentials. Please try again.', 'error')
        return redirect(url_for('admin_html'))

@app.route('/admin/menu')
def admin_menu():
    if not session.get('admin_logged_in'):
        return redirect(url_for('admin_html'))
    return render_template('menu.html', username=session.get('admin_username'))

# =====================
# Categories API (CRUD)
# =====================
@app.route('/api/categories', methods=['GET'])
@login_required
def api_list_categories():
    try:
        conn = create_db_connection()
        if not conn:
            return jsonify([])
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, name, description FROM categories ORDER BY id DESC")
        rows = cur.fetchall()
        cur.close(); conn.close()
        return jsonify(rows)
    except Exception as e:
        print('Error listing categories:', e)
        return jsonify([]), 500

@app.route('/api/categories', methods=['POST'])
@login_required
def api_create_category():
    name = (request.form.get('name') or request.json.get('name') if request.is_json else '').strip()
    description = (request.form.get('description') or (request.json.get('description') if request.is_json else ''))
    if not name:
        return jsonify({'error': 'name is required'}), 400
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("INSERT INTO categories (name, description) VALUES (%s, %s)", (name, description))
        conn.commit()
        new_id = cur.lastrowid
        cur.close(); conn.close()
        return jsonify({'id': new_id, 'name': name, 'description': description}), 201
    except Exception as e:
        print('Error creating category:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/api/categories/<int:category_id>', methods=['PUT'])
@login_required
def api_update_category(category_id):
    data = request.form if request.form else (request.json or {})
    name = (data.get('name') or '').strip()
    description = data.get('description')
    if not name:
        return jsonify({'error': 'name is required'}), 400
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("UPDATE categories SET name=%s, description=%s WHERE id=%s", (name, description, category_id))
        conn.commit(); cur.close(); conn.close()
        return jsonify({'id': category_id, 'name': name, 'description': description})
    except Exception as e:
        print('Error updating category:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/api/categories/<int:category_id>', methods=['DELETE'])
@login_required
def api_delete_category(category_id):
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("DELETE FROM categories WHERE id=%s", (category_id,))
        conn.commit(); cur.close(); conn.close()
        return jsonify({'deleted': True})
    except Exception as e:
        print('Error deleting category:', e)
        return jsonify({'error': 'failed'}), 500

# =====================
# Menu Items API (CRUD)
# =====================
@app.route('/api/menu-items', methods=['GET'])
@login_required
def api_list_menu_items():
    try:
        conn = create_db_connection(); cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT id, COALESCE(category_id, 0) AS category_id, name, description,
                   price, image_url, is_available
            FROM menu_items ORDER BY id DESC
        """)
        rows = cur.fetchall()
        # Convert Decimal and boolean types
        for r in rows:
            r['price'] = float(r['price']) if r['price'] is not None else 0.0
            r['is_available'] = bool(r['is_available'])
        cur.close(); conn.close()
        return jsonify(rows)
    except Exception as e:
        print('Error listing menu items:', e)
        return jsonify([]), 500

@app.route('/api/menu-items', methods=['POST'])
@login_required
def api_create_menu_item():
    data = request.form if request.form else (request.json or {})
    category_id = data.get('category_id')
    name = (data.get('name') or '').strip()
    description = data.get('description')
    price = data.get('price')
    image_url = data.get('image_url') or data.get('imageUrl')
    is_available = data.get('is_available')
    if is_available in (None, ''):
        is_available = True
    is_available = str(is_available).lower() in ['1', 'true', 'yes', 'on']
    # Optional 'category' string support: map or create category and set category_id
    if not category_id:
        cat_name = (data.get('category') or '').strip()
        if cat_name:
            try:
                tmp_conn = create_db_connection(); tmp_cur = tmp_conn.cursor()
                tmp_cur.execute("SELECT id FROM categories WHERE LOWER(name)=LOWER(%s) LIMIT 1", (cat_name,))
                row = tmp_cur.fetchone()
                if row:
                    category_id = row[0]
                else:
                    tmp_cur.execute("INSERT INTO categories (name) VALUES (%s)", (cat_name,))
                    tmp_conn.commit()
                    category_id = tmp_cur.lastrowid
                tmp_cur.close(); tmp_conn.close()
            except Exception as _:
                try:
                    tmp_cur.close(); tmp_conn.close()
                except Exception:
                    pass
    # Sanitize image url if provided
    if image_url not in (None, ''):
        sanitized = sanitize_image_url(image_url)
        if not sanitized:
            return jsonify({'error': 'invalid image url/path. Only http/https URLs or /static/*.jpg|.jpeg|.png are allowed.'}), 400
        image_url = sanitized
    else:
        image_url = None

    if not name or price is None:
        return jsonify({'error': 'name and price are required'}), 400
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO menu_items (category_id, name, description, price, image_url, is_available)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (category_id, name, description, price, image_url, is_available)
        )
        conn.commit(); new_id = cur.lastrowid
        cur.close(); conn.close()
        return jsonify({
            'id': new_id, 'category_id': int(category_id) if category_id else 0,
            'name': name, 'description': description, 'price': float(price),
            'image_url': image_url, 'is_available': is_available
        }), 201
    except Exception as e:
        print('Error creating menu item:', e)
        return jsonify({'error': 'failed'}), 500

# =====================
# Public Menu API (no auth)
# =====================
@app.route('/api/public/menu', methods=['GET'])
def api_public_menu():
    """Return available menu items for the user app, grouped with category name.
    This endpoint is public and does not require admin login.
    """
    try:
        conn = create_db_connection(); cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT 
                mi.id,
                mi.name,
                mi.description,
                mi.price,
                mi.image_url,
                mi.is_available,
                LOWER(COALESCE(c.name, 'uncategorized')) AS category
            FROM menu_items mi
            LEFT JOIN categories c ON c.id = mi.category_id
            WHERE mi.is_available = 1
            ORDER BY c.name IS NULL, c.name, mi.id DESC
            """
        )
        rows = cur.fetchall()
        for r in rows:
            r['price'] = float(r['price']) if r.get('price') is not None else 0.0
            r['is_available'] = bool(r.get('is_available'))
        cur.close(); conn.close()
        return jsonify(rows)
    except Exception as e:
        print('Error loading public menu:', e)
        return jsonify([]), 500

@app.route('/api/menu-items/<int:item_id>', methods=['PUT'])
@login_required
def api_update_menu_item(item_id):
    data = request.form if request.form else (request.json or {})
    fields = []
    values = []
    for key in ['category_id', 'name', 'description', 'price', 'image_url', 'is_available']:
        if key in data and data.get(key) is not None:
            if key == 'is_available':
                val = str(data.get(key)).lower() in ['1', 'true', 'yes', 'on']
            elif key == 'image_url':
                raw = data.get('image_url')
                if str(raw).strip() == '':
                    val = None
                else:
                    sanitized = sanitize_image_url(raw)
                    if not sanitized:
                        return jsonify({'error': 'invalid image url/path. Only http/https URLs or /static/*.jpg|.jpeg|.png are allowed.'}), 400
                    val = sanitized
            else:
                val = data.get(key)
            fields.append(f"{key}=%s"); values.append(val)
    if not fields:
        return jsonify({'error': 'no fields provided'}), 400
    try:
        conn = create_db_connection(); cur = conn.cursor()
        sql = f"UPDATE menu_items SET {', '.join(fields)} WHERE id=%s"
        values.append(item_id)
        cur.execute(sql, tuple(values))
        conn.commit(); cur.close(); conn.close()
        return jsonify({'updated': True})
    except Exception as e:
        print('Error updating menu item:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/api/menu-items/<int:item_id>', methods=['DELETE'])
@login_required
def api_delete_menu_item(item_id):
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("DELETE FROM menu_items WHERE id=%s", (item_id,))
        conn.commit(); cur.close(); conn.close()
        return jsonify({'deleted': True})
    except Exception as e:
        print('Error deleting menu item:', e)
        return jsonify({'error': 'failed'}), 500

# =====================
# Orders Review API
# =====================
@app.route('/api/orders', methods=['GET'])
@login_required
def api_list_orders():
    try:
        conn = create_db_connection(); cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT 
                o.id,
                o.order_number,
                o.table_number,
                o.customer_name,
                o.total_amount,
                o.discount_amount,
                o.final_amount,
                o.status,
                o.created_at,
                -- Build a compact items summary e.g., "Idli x 2, Tea x 1" using fallback to user-provided item_name
                TRIM(BOTH ', ' FROM COALESCE(GROUP_CONCAT(CONCAT(COALESCE(mi.name, oi.item_name, 'Item'), ' x ', oi.quantity)
                    ORDER BY oi.id SEPARATOR ', '), '')) AS items_summary
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
            GROUP BY o.id
            ORDER BY o.created_at DESC
            """
        )
        rows = cur.fetchall()
        for r in rows:
            # Convert Decimal to float for JSON
            r['total_amount'] = float(r['total_amount']) if r['total_amount'] is not None else 0.0
            r['discount_amount'] = float(r['discount_amount']) if r['discount_amount'] is not None else 0.0
            r['final_amount'] = float(r['final_amount']) if r['final_amount'] is not None else r['total_amount']
        cur.close(); conn.close()
        return jsonify(rows)
    except Exception as e:
        print('Error listing orders:', e)
        return jsonify([]), 500

@app.route('/api/orders/<int:order_id>', methods=['GET'])
@login_required
def api_get_order(order_id):
    try:
        conn = create_db_connection(); cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM orders WHERE id=%s", (order_id,))
        order = cur.fetchone()
        if not order:
            cur.close(); conn.close(); return jsonify({'error': 'not found'}), 404
        cur.execute("""
            SELECT oi.id, oi.quantity, oi.price, COALESCE(mi.name, oi.item_name) AS name
            FROM order_items oi
            LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
            WHERE oi.order_id=%s
        """, (order_id,))
        items = cur.fetchall()
        order['items'] = items
        cur.close(); conn.close()
        return jsonify(order)
    except Exception as e:
        print('Error getting order:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/api/orders/<int:order_id>/status', methods=['PUT'])
@login_required
def api_update_order_status(order_id):
    status = (request.form.get('status') or (request.json.get('status') if request.is_json else '')).strip()
    if status not in ['pending', 'preparing', 'completed', 'cancelled']:
        return jsonify({'error': 'invalid status'}), 400
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("UPDATE orders SET status=%s, updated_at=%s WHERE id=%s", (status, datetime.now(), order_id))
        conn.commit(); cur.close(); conn.close()
        return jsonify({'updated': True, 'status': status})
    except Exception as e:
        print('Error updating order status:', e)
        return jsonify({'error': 'failed'}), 500

# =====================
# Support Logs API
# =====================
@app.route('/api/support-logs', methods=['GET'])
@login_required
def api_list_support_logs():
    try:
        conn = create_db_connection(); cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, name, email, message, status, created_at FROM support_logs ORDER BY created_at DESC")
        rows = cur.fetchall(); cur.close(); conn.close()
        return jsonify(rows)
    except Exception as e:
        print('Error listing support logs:', e)
        return jsonify([]), 500

@app.route('/api/support-logs', methods=['POST'])
def api_create_support_log():
    # Public endpoint to allow customers to submit support requests
    name = (request.form.get('name') or (request.json.get('name') if request.is_json else '')).strip()
    email = (request.form.get('email') or (request.json.get('email') if request.is_json else '')).strip()
    message = (request.form.get('message') or (request.json.get('message') if request.is_json else '')).strip()
    if not message:
        return jsonify({'error': 'message is required'}), 400
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("INSERT INTO support_logs (name, email, message) VALUES (%s, %s, %s)", (name, email, message))
        conn.commit(); new_id = cur.lastrowid
        cur.close(); conn.close()
        return jsonify({'id': new_id, 'status': 'open'}), 201
    except Exception as e:
        print('Error creating support log:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/api/support-logs/<int:log_id>', methods=['PUT'])
@login_required
def api_update_support_log(log_id):
    status = (request.form.get('status') or (request.json.get('status') if request.is_json else '')).strip()
    if status not in ['open', 'in_progress', 'resolved']:
        return jsonify({'error': 'invalid status'}), 400
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("UPDATE support_logs SET status=%s WHERE id=%s", (status, log_id))
        conn.commit(); cur.close(); conn.close()
        return jsonify({'updated': True})
    except Exception as e:
        print('Error updating support log:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/api/support-logs/<int:log_id>', methods=['DELETE'])
@login_required
def api_delete_support_log(log_id):
    try:
        conn = create_db_connection(); cur = conn.cursor()
        cur.execute("DELETE FROM support_logs WHERE id=%s", (log_id,))
        conn.commit(); cur.close(); conn.close()
        return jsonify({'deleted': True})
    except Exception as e:
        print('Error deleting support log:', e)
        return jsonify({'error': 'failed'}), 500

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

# Error handlers
@app.errorhandler(404)
def not_found_error(error):
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    return render_template('500.html'), 500
    

if __name__ == '__main__':
    print("🚀 Starting Scan-N-Dine Flask Application")
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)