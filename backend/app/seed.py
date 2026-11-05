"""Generate a realistic demo e-commerce SQLite database on first boot."""
from __future__ import annotations

import random
import sqlite3
from datetime import date, timedelta

CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安", "南京", "苏州"]
SEGMENTS = ["个人", "企业", "VIP"]
CHANNELS = ["Web", "App", "小程序", "线下"]
STATUSES = ["已完成", "已完成", "已完成", "已完成", "待发货", "已取消", "退款"]
CATEGORIES = ["数码电子", "家居生活", "服饰鞋包", "食品饮料"]
PRODUCTS = [
    ("无线降噪耳机", 0, 899.0),
    ("机械键盘", 0, 459.0),
    ("4K 显示器", 0, 2199.0),
    ("便携充电宝", 0, 169.0),
    ("智能台灯", 1, 239.0),
    ("人体工学椅", 1, 1299.0),
    ("纯棉四件套", 1, 399.0),
    ("轻量跑鞋", 2, 529.0),
    ("通勤双肩包", 2, 329.0),
    ("精品挂耳咖啡", 3, 89.0),
    ("坚果礼盒", 3, 129.0),
    ("冷萃气泡水", 3, 39.0),
]


def build_demo_db(path: str, force: bool = False) -> str:
    """Create the demo database. Returns the path."""
    conn = sqlite3.connect(path)
    try:
        exists = conn.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='orders'"
        ).fetchone()[0]
        if exists and not force:
            return path
        cur = conn.cursor()
        cur.executescript(
            """
            DROP VIEW IF EXISTS v_monthly_sales;
            DROP TABLE IF EXISTS order_items;
            DROP TABLE IF EXISTS orders;
            DROP TABLE IF EXISTS products;
            DROP TABLE IF EXISTS categories;
            DROP TABLE IF EXISTS customers;

            CREATE TABLE categories (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                city TEXT NOT NULL,
                country TEXT NOT NULL DEFAULT '中国',
                segment TEXT NOT NULL,
                created_at DATE NOT NULL
            );
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category_id INTEGER NOT NULL REFERENCES categories(id),
                price REAL NOT NULL,
                stock INTEGER NOT NULL
            );
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                status TEXT NOT NULL,
                order_date DATE NOT NULL,
                total_amount REAL NOT NULL,
                channel TEXT NOT NULL
            );
            CREATE TABLE order_items (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id),
                product_id INTEGER NOT NULL REFERENCES products(id),
                quantity INTEGER NOT NULL,
                unit_price REAL NOT NULL
            );
            CREATE INDEX idx_orders_date ON orders(order_date);
            CREATE INDEX idx_orders_customer ON orders(customer_id);
            CREATE INDEX idx_items_order ON order_items(order_id);
            CREATE INDEX idx_items_product ON order_items(product_id);
            CREATE VIEW v_monthly_sales AS
                SELECT substr(order_date, 1, 7) AS month,
                       ROUND(SUM(total_amount), 2) AS revenue,
                       COUNT(*) AS order_count
                FROM orders WHERE status = '已完成'
                GROUP BY substr(order_date, 1, 7);
            """
        )
        rnd = random.Random(20261105)
        today = date.today()

        categories = [(i + 1, name) for i, name in enumerate(CATEGORIES)]
        cur.executemany("INSERT INTO categories VALUES (?,?)", categories)

        customers = []
        surnames = "王李张刘陈杨黄赵周吴徐孙马朱胡郭何高林罗郑"
        given = "伟芳娜秀敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂兰文辉"
        for i in range(1, 61):
            name = rnd.choice(surnames) + rnd.choice(given) + (rnd.choice(given) if rnd.random() < 0.35 else "")
            created = today - timedelta(days=rnd.randint(30, 900))
            customers.append(
                (i, name, rnd.choice(CITIES), "中国", rnd.choice(SEGMENTS), created.isoformat())
            )
        cur.executemany("INSERT INTO customers VALUES (?,?,?,?,?,?)", customers)

        products = []
        for i, (name, cat, price) in enumerate(PRODUCTS, start=1):
            products.append((i, name, cat + 1, price, rnd.randint(20, 600)))
        cur.executemany("INSERT INTO products VALUES (?,?,?,?,?)", products)

        # 12 months of orders with a mild upward trend + seasonal peaks
        orders, items = [], []
        oid = 1
        iid = 1
        for month_offset in range(11, -1, -1):
            base = today.replace(day=1) - timedelta(days=month_offset * 30)
            volume = int(24 + (11 - month_offset) * 1.6 + rnd.randint(-6, 8))
            if base.month in (6, 11):
                volume = int(volume * 1.45)  # shopping festivals
            for _ in range(volume):
                day = rnd.randint(1, 28)
                odate = date(base.year, base.month, day)
                if odate > today:
                    odate = today
                cust = rnd.choice(customers)
                status = rnd.choice(STATUSES)
                channel = rnd.choice(CHANNELS)
                n_lines = rnd.randint(1, 4)
                total = 0.0
                chosen = rnd.sample(products, n_lines)
                for prod in chosen:
                    qty = rnd.randint(1, 5)
                    unit = round(prod[3] * rnd.uniform(0.82, 1.0), 2)
                    items.append((iid, oid, prod[0], qty, unit))
                    total += qty * unit
                    iid += 1
                orders.append((oid, cust[0], status, odate.isoformat(), round(total, 2), channel))
                oid += 1
        cur.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?)", orders)
        cur.executemany("INSERT INTO order_items VALUES (?,?,?,?,?)", items)
        conn.commit()
        return path
    finally:
        conn.close()
