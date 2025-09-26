// Restaurant App JavaScript Functionality

// Discount codes and their details
const discountCodes = {
    "WEEKEND30": { type: "percentage", value: 30, text: "Weekend Special - 30% off" },
    "FIRST20": { type: "percentage", value: 20, text: "First Order - 20% off" },
    "FAMILY25": { type: "percentage", value: 25, text: "Family Pack - 25% off" },
    "STUDENT15": { type: "percentage", value: 15, text: "Student Discount - 15% off" },
    "HAPPY40": { type: "percentage", value: 40, text: "Happy Hours - 40% off" }
};

// State management
let cart = [];
let currentSlide = 0;
let currentCategory = 'breakfast';
let appliedDiscount = null;
let tableNumber = null;

// DOM elements
const cartIcon = document.querySelector('.cart-icon');
const cartModal = document.getElementById('cartModal');
const cartClose = document.getElementById('cartClose');
const cartItems = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');
const cartCount = document.querySelector('.cart-count');
const checkoutBtn = document.getElementById('checkoutBtn');
const searchInput = document.getElementById('searchInput');
const toastContainer = document.getElementById('toastContainer');
const receiptModal = document.getElementById('receiptModal');
const receiptClose = document.getElementById('receiptClose');
const printReceiptBtn = document.getElementById('printReceiptBtn');
const paymentModal = document.getElementById('payment-modal');
const closePayment = document.getElementById('close-payment');
const cancelPayment = document.getElementById('cancel-payment');
const payNowBtn = document.getElementById('pay-now');

closePayment.addEventListener('click', () => paymentModal.classList.remove('active'));
cancelPayment.addEventListener('click', () => paymentModal.classList.remove('active'));

// Table number validation helpers
function validateTableNumber(showMessage = true) {
    const input = document.getElementById('tableNumber');
    const errorEl = document.getElementById('tableNumberError');
    if (!input) return true; // if input not present, allow

    const raw = (input.value || '').trim();
    const value = Number(raw);
    let valid = true;
    let message = '';

    if (raw === '') {
        valid = false;
        message = 'Table number is required';
    } else if (!Number.isInteger(value)) {
        valid = false;
        message = 'Please enter a valid whole number between 1 and 15';
    } else if (value < 1 || value > 15) {
        valid = false;
        message = 'Table number must be between 1 and 15';
    }

    if (showMessage && errorEl) {
        errorEl.textContent = valid ? '' : message;
    }
    input.classList.toggle('error', !valid);
    return valid;
}

function wireTableNumberValidation() {
    const input = document.getElementById('tableNumber');
    const errorEl = document.getElementById('tableNumberError');
    if (!input) return;

    const handler = () => {
        // Remove leading zeros and non-digits, clamp to [1,15]
        let v = input.value.replace(/[^0-9]/g, '');
        if (v !== '') {
            let n = Number(v);
            if (n < 1) n = 1;
            if (n > 15) n = 15;
            input.value = String(n);
        }
        validateTableNumber(true);
    };
    input.addEventListener('input', handler);
    input.addEventListener('blur', handler);
}

// Checkout button opens UPI modal (with table number validation)
checkoutBtn.addEventListener('click', () => {
    if (cart.length === 0) {
        showToast('Your cart is empty!', 'error');
        return;
    }

    // Table number required and must be within 1–15
    if (!validateTableNumber(true)) {
        showToast('Please enter a valid table number (1–15).', 'error');
        return;
    }

    cartModal.classList.remove('active');
    paymentModal.classList.add('active');

    // Populate payment summary
    try {
        const itemsCount = cart.reduce((sum, it) => sum + it.quantity, 0);
        const subtotal = cart.reduce((sum, it) => sum + (it.price * it.quantity), 0);
        let discountAmount = 0;
        if (appliedDiscount) {
            if (appliedDiscount.type === 'percentage') discountAmount = (subtotal * appliedDiscount.value) / 100;
            else if (appliedDiscount.type === 'fixed') discountAmount = appliedDiscount.value;
        }
        const total = Math.max(0, subtotal - discountAmount);
        const payItemsEl = document.getElementById('pay-items-count');
        const payAmountEl = document.getElementById('pay-amount');
        if (payItemsEl) payItemsEl.textContent = String(itemsCount);
        if (payAmountEl) payAmountEl.textContent = String(total);
    } catch (_) {}
});

// Handle UPI Payment with success tick animation first
payNowBtn.addEventListener('click', async () => {
    const upiId = document.getElementById('upi').value.trim();
    const app = document.getElementById('app').value;

    if (!upiId || !app) {
        showToast('Please enter your UPI ID and select an app!', 'error');
        return;
    }

    // Validate that items in cart are still available (admin might have removed or disabled them)
    try {
        const res = await fetch('/api/public/menu');
        if (res.ok) {
            const liveItems = await res.json();
            const availableNames = new Set((liveItems || []).filter(it => it.is_available).map(it => String(it.name).toLowerCase()));
            const removed = [];
            cart = cart.filter(it => {
                const keep = availableNames.has(String(it.name).toLowerCase());
                if (!keep) removed.push(it.name);
                return keep;
            });
            if (removed.length > 0) {
                showToast(`Removed unavailable items: ${removed.join(', ')}`, 'error');
                updateCartDisplay();
            }
            if (cart.length === 0) {
                showToast('Your cart is empty after updates. Please pick available items.', 'error');
                return;
            }
        }
    } catch (_) {
        // If validation fails silently, continue; server will still accept names but admin removed items won't appear in menu
    }

    payNowBtn.textContent = 'Processing...';
    payNowBtn.disabled = true;

    // Play success tick overlay first
    const successOverlay = document.getElementById('payment-success');
    if (successOverlay) {
        successOverlay.classList.add('active');
    }

    // After animation completes, finalize payment and create order
    setTimeout(() => {
        // Get table number before showing receipt
        const tableNumberInput = document.getElementById('tableNumber');
        tableNumber = tableNumberInput ? tableNumberInput.value : null;

        // Create order items from current cart
        const orderItems = [...cart];
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // Calculate discount
        let discountAmount = 0;
        if (appliedDiscount) {
            if (appliedDiscount.type === "percentage") {
                discountAmount = (subtotal * appliedDiscount.value) / 100;
            } else if (appliedDiscount.type === "fixed") {
                discountAmount = appliedDiscount.value;
            }
        }
        
        const total = Math.max(0, subtotal - discountAmount);
        
        // Persist order to backend then show receipt
        const discountInputEl = document.getElementById('discountCode');
        const discount_code = discountInputEl ? (discountInputEl.value || '').trim().toUpperCase() : null;

        let serverOrder = null;
        fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                table_number: tableNumber || null,
                discount_code: discount_code || null,
                items: orderItems.map(it => ({ name: it.name, price: it.price, quantity: it.quantity }))
            })
        }).then(async (res) => {
            serverOrder = await res.json().catch(() => null);
        }).catch(() => {
            serverOrder = null;
        }).finally(() => {
            // Hide overlay and modal
            if (successOverlay) successOverlay.classList.remove('active');
            paymentModal.classList.remove('active');
            payNowBtn.textContent = 'Pay Now';
            payNowBtn.disabled = false;

            showToast('UPI Payment Successful!', 'success');
            // Always show receipt
            showReceipt(orderItems, subtotal, discountAmount, total);
            if (serverOrder && serverOrder.order_number) {
                const el = document.getElementById('receiptOrderId');
                if (el) el.textContent = serverOrder.order_number;
            }

            // Clear cart after successful payment
            cart = [];
            appliedDiscount = null;
            updateCartDisplay();
        });
    }, 1300); // duration to allow tick animation to play
});


// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeCarousel();
    initializeCategories();
    initializeCart();
    initializeSearch();
    initializeFoodCards();
    initializeDiscounts();
    wireTableNumberValidation();

    // Load dynamic menu from server (items added in admin panel)
    loadPublicMenu();

    // Auto-advance carousel
    setInterval(nextSlide, 4000);
});

// Carousel functionality
function initializeCarousel() {
    const track = document.getElementById('carouselTrack');
    const dots = document.querySelectorAll('.dot');

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => goToSlide(index));
    });
}

function goToSlide(slideIndex) {
    const track = document.getElementById('carouselTrack');
    const dots = document.querySelectorAll('.dot');

    currentSlide = slideIndex;
    track.style.transform = `translateX(-${slideIndex * 100}%)`;

    // Update dots
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === slideIndex);
    });
}

function nextSlide() {
    const totalSlides = document.querySelectorAll('.carousel-slide').length;
    currentSlide = (currentSlide + 1) % totalSlides;
    goToSlide(currentSlide);
}

// Category functionality
function initializeCategories() {
    const categoryBtns = document.querySelectorAll('.category-btn');
    const menuCategories = document.querySelectorAll('.menu-category');

    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            switchCategory(category);
        });
    });
}

function switchCategory(category) {
    const categoryBtns = document.querySelectorAll('.category-btn');
    const menuCategories = document.querySelectorAll('.menu-category');

    // Update buttons
    categoryBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === category);
    });

    // Update content
    menuCategories.forEach(menu => {
        menu.classList.toggle('active', menu.id === category);
    });

    currentCategory = category;

    // Animate category switch
    const activeCategory = document.getElementById(category);
    if (activeCategory) {
        activeCategory.style.opacity = '0';
        activeCategory.style.transform = 'translateY(20px)';

        setTimeout(() => {
            activeCategory.style.transition = 'all 0.5s ease-out';
            activeCategory.style.opacity = '1';
            activeCategory.style.transform = 'translateY(0)';
        }, 50);
    }
}

// Dynamic menu loading from backend so admin-added items show up for users
async function loadPublicMenu() {
    try {
        const res = await fetch('/api/public/menu');
        if (!res.ok) return;
        const items = await res.json();
        renderPublicMenu(items || []);
        // Bind add-to-cart for newly injected buttons
        initializeFoodCards();
    } catch (e) {
        console.warn('Public menu load failed', e);
    }
}

function renderPublicMenu(items) {
    if (!Array.isArray(items)) return;
    const byCat = items.reduce((acc, it) => {
        const key = (it.category || '').toLowerCase();
        (acc[key] ||= []).push(it);
        return acc;
    }, {});

    ['breakfast','lunch','beverages'].forEach(cat => {
        const grid = document.querySelector(`#${cat} .food-grid`);
        if (!grid) return;

        // Only display admin-added products: clear any hardcoded demo cards
        grid.innerHTML = '';

        const existing = new Set();

        (byCat[cat] || []).forEach(it => {
            const name = (it.name || '').trim();
            if (!name || existing.has(name.toLowerCase())) return;
            const price = Number(it.price || 0);
            const img = it.image_url || 'static/Banner.jpg';
            const desc = it.description || '';

            const card = document.createElement('div');
            card.className = 'food-card';
            card.setAttribute('data-dyn', '1');
            card.setAttribute('data-price', String(price));
            card.innerHTML = `
                <div class="food-image">
                    <img src="${img}" alt="${escapeHtml(name)}">
                    <button class="add-btn" data-item="${escapeHtml(name)}" data-price="${price}">+</button>
                </div>
                <div class="food-info">
                    <h4>${escapeHtml(name)}</h4>
                    <p>${escapeHtml(desc)}</p>
                    <div class="food-meta">
                        <span class="price">₹${price}</span>
                        <div class="rating">
                            <span class="stars">★★★★☆</span>
                            <span class="rating-text">4.5</span>
                        </div>
                    </div>
                </div>`;
            grid.prepend(card);
            existing.add(name.toLowerCase());
        });
    });
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (s) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[s]);
}

// Cart functionality
function initializeCart() {
    cartIcon.addEventListener('click', openCart);
    cartClose.addEventListener('click', closeCart);
    receiptClose.addEventListener('click', closeReceipt);
    printReceiptBtn.addEventListener('click', printReceipt);

    // Close cart when clicking outside
    cartModal.addEventListener('click', (e) => {
        if (e.target === cartModal) {
            closeCart();
        }
    });

    // Close receipt when clicking outside
    receiptModal.addEventListener('click', (e) => {
        if (e.target === receiptModal) {
            closeReceipt();
        }
    });

    updateCartDisplay();
}

// Initialize discount functionality
function initializeDiscounts() {
    const applyDiscountBtn = document.getElementById('applyDiscountBtn');
    const discountCodeInput = document.getElementById('discountCode');

    if (applyDiscountBtn && discountCodeInput) {
        applyDiscountBtn.addEventListener('click', applyDiscount);

        discountCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                applyDiscount();
            }
        });
    }
}

// Apply discount code
function applyDiscount() {
    const discountCode = document.getElementById('discountCode').value.trim().toUpperCase();
    const discountMessage = document.getElementById('discountMessage');

    if (!discountCode) {
        discountMessage.textContent = "Please enter a discount code";
        discountMessage.className = "discount-message error";
        return;
    }

    if (discountCodes[discountCode]) {
        appliedDiscount = discountCodes[discountCode];
        discountMessage.textContent = `Applied: ${appliedDiscount.text}`;
        discountMessage.className = "discount-message success";
        updateCartDisplay();
    } else {
        appliedDiscount = null;
        discountMessage.textContent = "Invalid discount code";
        discountMessage.className = "discount-message error";
        updateCartDisplay();
    }
}

function initializeFoodCards() {
    const addBtns = document.querySelectorAll('.add-btn');

    addBtns.forEach(btn => {
        // Avoid attaching multiple listeners if this function is called again
        if (btn.dataset.bound === '1') return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const itemName = btn.dataset.item;
            const itemPrice = parseInt(btn.dataset.price);
            addToCart(itemName, itemPrice, btn);
        });
        btn.dataset.bound = '1';
    });
}

function addToCart(name, price, btnElement) {
    const existingItem = cart.find(item => item.name === name);

    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({
            name: name,
            price: price,
            quantity: 1
        });
    }

    updateCartDisplay();
    animateAddButton(btnElement);
    showToast(`${name} added to cart!`, 'success');
}

function removeFromCart(name) {
    const itemIndex = cart.findIndex(item => item.name === name);
    if (itemIndex > -1) {
        cart.splice(itemIndex, 1);
        updateCartDisplay();
        showToast(`${name} removed from cart`, 'error');
    }
}

function updateQuantity(name, change) {
    const item = cart.find(item => item.name === name);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            removeFromCart(name);
        } else {
            updateCartDisplay();
        }
    }
}

// Update cart display with discount calculation
function updateCartDisplay() {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Calculate discount
    let discountAmount = 0;
    if (appliedDiscount) {
        if (appliedDiscount.type === "percentage") {
            discountAmount = (subtotal * appliedDiscount.value) / 100;
        } else if (appliedDiscount.type === "fixed") {
            discountAmount = appliedDiscount.value;
        }
    }

    const total = Math.max(0, subtotal - discountAmount);

    // Update cart count
    cartCount.textContent = totalItems;
    cartCount.style.display = totalItems > 0 ? 'flex' : 'none';

    // Update cart summary
    document.getElementById('cartSubtotal').textContent = subtotal;
    document.getElementById('cartDiscount').textContent = discountAmount;
    document.getElementById('cartTotal').textContent = total;

    // Show/hide discount row
    const discountContainer = document.getElementById('cartDiscountContainer');
    if (discountContainer) {
        discountContainer.style.display = discountAmount > 0 ? 'flex' : 'none';
    }

    // Update cart items
    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-cart">Your cart is empty</p>';
        checkoutBtn.disabled = true;

        // Reset discount if cart is empty
        appliedDiscount = null;
        if (document.getElementById('discountCode')) {
            document.getElementById('discountCode').value = '';
        }
        if (document.getElementById('discountMessage')) {
            document.getElementById('discountMessage').textContent = '';
            document.getElementById('discountMessage').className = "discount-message";
        }
    } else {
        cartItems.innerHTML = cart.map(item => `
            <div class="cart-item">
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    <div class="item-price">₹${item.price}</div>
                </div>
                <div class="quantity-controls">
                    <button class="qty-btn" onclick="updateQuantity('${item.name}', -1)">-</button>
                    <span class="quantity">${item.quantity}</span>
                    <button class="qty-btn" onclick="updateQuantity('${item.name}', 1)">+</button>
                </div>
            </div>
        `).join('');
        checkoutBtn.disabled = false;
    }
}

function openCart() {
    cartModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    cartModal.classList.remove('active');
    document.body.style.overflow = 'auto';
}
// Update the processCheckout function to include discount in receipt
function processCheckout() {
    if (cart.length === 0) return;

    // Get table number
    const tableNumberInput = document.getElementById('tableNumber');
    tableNumber = tableNumberInput ? tableNumberInput.value : null;

    const orderItems = [...cart];
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Calculate discount for receipt
    let discountAmount = 0;
    if (appliedDiscount) {
        if (appliedDiscount.type === "percentage") {
            discountAmount = (subtotal * appliedDiscount.value) / 100;
        } else if (appliedDiscount.type === "fixed") {
            discountAmount = appliedDiscount.value;
        }
    }

    const total = Math.max(0, subtotal - discountAmount);

    showToast('Processing your order...', 'info');

    setTimeout(() => {
        closeCart();
        showReceipt(orderItems, subtotal, discountAmount, total);
        cart = [];
        appliedDiscount = null;
        updateCartDisplay();
        showToast('Order placed successfully!', 'success');
    }, 1500);
}

// Receipt functionality
function showReceipt(orderItems, subtotal, discountAmount, total) {
    // For demo purposes, we'll use the items from the image
    const demoItems = [
        { name: "Accel Smoothie Bowl", price: 349, quantity: 2 },
        { name: "Fluffy Pancakes", price: 298, quantity: 2 }
    ];

    // Use actual values if we have items in cart, otherwise use demo values
    const finalSubtotal = orderItems.length > 0 ? subtotal : demoItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const finalDiscount = orderItems.length > 0 ? discountAmount : 0;
    const finalTotal = orderItems.length > 0 ? total : finalSubtotal - finalDiscount;

    // Generate a random order ID
    const orderId = "SND-" + new Date().getFullYear() + "-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    document.getElementById('receiptOrderId').textContent = orderId;

    // Set the date from the image
    // Set the current date and time
    const now = new Date();
    const formattedDate = now.toLocaleString('en-IN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    document.getElementById('receiptDate').textContent = formattedDate;

    // Set table number
    const receiptTableNumber = document.getElementById('receiptTableNumber');
    if (receiptTableNumber) {
        receiptTableNumber.textContent = tableNumber || '-';
    }

    // Populate items - use actual items if available, otherwise use demo items
    const receiptItems = document.getElementById('receiptItemsList');
    if (orderItems.length > 0) {
        receiptItems.innerHTML = orderItems.map(item => `
            <div class="receipt-item">
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    <div class="item-qty">Qty: ${item.quantity}</div>
                </div>
                <div class="item-price">₹${item.price * item.quantity}</div>
            </div>
        `).join('');
    } else {
        receiptItems.innerHTML = demoItems.map(item => `
            <div class="receipt-item">
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    <div class="item-qty">Qty: ${item.quantity}</div>
                </div>
                <div class="item-price">₹${item.price * item.quantity}</div>
            </div>
        `).join('');
    }

    // Set totals
    document.getElementById('receiptSubtotal').textContent = finalSubtotal;
    document.getElementById('receiptTotal').textContent = finalTotal;

    // Add discount row if there's a discount
    const discountRow = document.getElementById('receiptDiscountRow');
    if (finalDiscount > 0) {
        document.getElementById('receiptDiscount').textContent = finalDiscount;
        discountRow.style.display = 'flex';
    } else {
        discountRow.style.display = 'none';
    }

    // Initialize download button
    const downloadBtn = document.getElementById('downloadReceiptBtn');
    downloadBtn.onclick = () => downloadReceipt(orderItems, finalSubtotal, finalDiscount, finalTotal, orderId);

    receiptModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeReceipt() {
    receiptModal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function downloadReceipt(orderItems, subtotal, discountAmount, total, orderId) {
    // Create a printable version of the receipt
    const receiptDate = document.getElementById('receiptDate').textContent;

    const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Scan-N-Dine Receipt - ${orderId}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 300px;
                    margin: 0 auto;
                    padding: 20px;
                    color: #333;
                }
                .header {
                    text-align: center;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #ff6b35;
                }
                .logo {
                    font-size: 24px;
                    font-weight: bold;
                    color: #ff6b35;
                    margin-bottom: 10px;
                }
                .thank-you {
                    font-size: 16px;
                    margin-bottom: 15px;
                }
                .order-info {
                    font-size: 12px;
                    color: #666;
                    margin-bottom: 15px;
                }
                .divider {
                    height: 1px;
                    background: linear-gradient(to right, transparent, #ddd, transparent);
                    margin: 15px 0;
                }
                .item {
                    display: flex;
                    justify-content: space-between;
                    margin: 10px 0;
                }
                .item-name {
                    font-weight: bold;
                }
                .item-qty {
                    font-size: 12px;
                    color: #666;
                }
                .item-price {
                    font-weight: bold;
                    color: #2e7d32;
                }
                .totals {
                    margin: 20px 0;
                }
                .total-row {
                    display: flex;
                    justify-content: space-between;
                    margin: 8px 0;
                }
                .discount {
                    color: #e65100;
                }
                .grand-total {
                    font-weight: bold;
                    font-size: 18px;
                    border-top: 2px dashed #ddd;
                    padding-top: 10px;
                    margin-top: 15px;
                    color: #2e7d32;
                }
                .footer {
                    text-align: center;
                    margin-top: 20px;
                    font-style: italic;
                    color: #666;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">Scan-N-Dine</div>
                <div class="thank-you">Thank you for your order!</div>
                <div class="order-info">
                    <p><strong>Order #:</strong> ${orderId}</p>
                    <p><strong>Table #:</strong> ${tableNumber || '-'}</p>
                    <p><strong>Order Date:</strong> ${receiptDate}</p>
                </div>
            </div>
            
            <div class="divider"></div>
            
            ${document.getElementById('receiptItemsList').innerHTML.replace(/receipt-item/g, 'item').replace(/<div class="item-info">/g, '<div>').replace(/<div class="item-price">/g, '<div class="item-price">')}
            
            <div class="divider"></div>
            
            <div class="totals">
                <div class="total-row">
                    <span>Subtotal:</span>
                    <span>₹${subtotal}</span>
                </div>
                ${discountAmount > 0 ? `
                <div class="total-row discount">
                    <span>Discount:</span>
                    <span>-₹${discountAmount}</span>
                </div>
                ` : ''}
                <div class="total-row grand-total">
                    <span>Total Paid:</span>
                    <span>₹${total}</span>
                </div>
            </div>
            
            <div class="divider"></div>
            
            <div class="footer">
                <p>Thank you for dining with us!</p>
                <p>We hope to see you again soon</p>
            </div>
        </body>
        </html>
    `;
    
    // Create a Blob and download link
    const blob = new Blob([printContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `Scan-N-Dine-Receipt-${orderId}.html`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    
    showToast('Receipt downloaded successfully!', 'success');
}

function printReceipt() {
    // Create a printable version of the receipt
    const orderId = document.getElementById('receiptOrderId').textContent;
    const receiptDate = document.getElementById('receiptDate').textContent;
    const subtotal = document.getElementById('receiptSubtotal').textContent;
    const total = document.getElementById('receiptTotal').textContent;
    const discount = document.getElementById('receiptDiscount').textContent;
    
    const printContent = `
        <div style="font-family: Arial, sans-serif; max-width: 300px; margin: 0 auto; padding: 20px; color: #333;">
            <div style="text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #ff6b35;">
                <div style="font-size: 24px; font-weight: bold; color: #ff6b35; margin-bottom: 10px;">Scan-N-Dine</div>
                <div style="font-size: 16px; margin-bottom: 15px;">Thank you for your order!</div>
                <div style="font-size: 12px; color: #666;">
                    <p><strong>Order #:</strong> ${orderId}</p>
                    <p><strong>Order Date:</strong> ${receiptDate}</p>
                </div>
            </div>
            
            <div style="height: 1px; background: linear-gradient(to right, transparent, #ddd, transparent); margin: 15px 0;"></div>
            
            ${document.getElementById('receiptItemsList').innerHTML.replace(/receipt-item/g, 'div').replace(/<div class="item-info">/g, '<div style="flex: 1;">').replace(/<div class="item-price">/g, '<div style="font-weight: bold; color: #2e7d32;">')}
            
            <div style="height: 1px; background: linear-gradient(to right, transparent, #ddd, transparent); margin: 15px 0;"></div>
            
            <div style="margin: 20px 0;">
                <div style="display: flex; justify-content: space-between; margin: 8px 0;">
                    <span>Subtotal:</span>
                    <span>₹${subtotal}</span>
                </div>
                ${discount > 0 ? `
                <div style="display: flex; justify-content: space-between; margin: 8px 0; color: #e65100;">
                    <span>Discount:</span>
                    <span>-₹${discount}</span>
                </div>
                ` : ''}
                <div style="display: flex; justify-content: space-between; margin: 8px 0; font-weight: bold; font-size: 18px; border-top: 2px dashed #ddd; padding-top: 10px; margin-top: 15px; color: #2e7d32;">
                    <span>Total Paid:</span>
                    <span>¥${total}</span>
                </div>
            </div>
            
            <div style="height: 1px; background: linear-gradient(to right, transparent, #ddd, transparent); margin: 15px 0;"></div>
            
            <div style="text-align: center; margin-top: 20px; font-style: italic; color: #666;">
                <p>Thank you for dining with us!</p>
                <p>We hope to see you again soon</p>
            </div>
        </div>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Scan-N-Dine Receipt - ${orderId}</title>
            </head>
            <body onload="window.print(); window.close();">
                ${printContent}
            </body>
        </html>
    `);
    printWindow.document.close();
}

// Search functionality
function initializeSearch() {
    searchInput.addEventListener('input', handleSearch);
}

function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();
    const foodCards = document.querySelectorAll('.food-card');

    foodCards.forEach(card => {
        const foodName = card.querySelector('h4').textContent.toLowerCase();
        const foodDescription = card.querySelector('p').textContent.toLowerCase();
        const isMatch = foodName.includes(searchTerm) || foodDescription.includes(searchTerm);

        card.style.display = isMatch ? 'block' : 'none';

        if (isMatch) {
            card.style.animation = 'fadeIn 0.3s ease-out';
        }
    });

    // If searching, show all categories
    if (searchTerm) {
        document.querySelectorAll('.menu-category').forEach(category => {
            category.classList.add('active');
        });
    } else {
        // Return to normal category view
        document.querySelectorAll('.menu-category').forEach(category => {
            category.classList.remove('active');
        });
        document.getElementById(currentCategory).classList.add('active');
    }
}

// Animation helpers
function animateAddButton(btnElement) {
    btnElement.style.transform = 'scale(1.3) rotate(180deg)';
    btnElement.style.background = 'linear-gradient(45deg, #4caf50, #8bc34a)';

    setTimeout(() => {
        btnElement.style.transform = 'scale(1) rotate(0deg)';
        btnElement.style.background = 'linear-gradient(45deg, var(--primary-orange), var(--deep-orange))';
    }, 300);
}

// Toast notifications
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.transform = 'translateX(100%)';
            toast.style.opacity = '0';
            setTimeout(() => {
                toastContainer.removeChild(toast);
            }, 300);
        }
    }, 3000);
}

// Smooth scrolling for better UX
function smoothScrollTo(elementId) {
    document.getElementById(elementId).scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

// Add loading states
function showLoading(element) {
    element.style.opacity = '0.5';
    element.style.pointerEvents = 'none';
}

function hideLoading(element) {
    element.style.opacity = '1';
    element.style.pointerEvents = 'auto';
}

// Add fade-in animation for cards
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const fadeInObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            fadeInObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

// Apply fade-in animation to food cards
document.addEventListener('DOMContentLoaded', () => {
    const foodCards = document.querySelectorAll('.food-card');
    foodCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `opacity 0.6s ease-out ${index * 0.1}s, transform 0.6s ease-out ${index * 0.1}s`;
        fadeInObserver.observe(card);
    });
});

// Enhanced category switching with stagger animation
function enhancedCategorySwitch(category) {
    const foodCards = document.querySelectorAll(`#${category} .food-card`);

    foodCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';

        setTimeout(() => {
            card.style.transition = 'all 0.4s ease-out';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape key to close cart
    if (e.key === 'Escape' && cartModal.classList.contains('active')) {
        closeCart();
    }

    // Ctrl/Cmd + K to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
    }
});

// Add ripple effect to buttons
function createRipple(e) {
    const button = e.currentTarget;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;

    const ripple = document.createElement('span');
    ripple.style.cssText = `
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        transform: scale(0);
        animation: ripple 0.6s linear;
        left: ${x}px;
        top: ${y}px;
        width: ${size}px;
        height: ${size}px;
        pointer-events: none;
    `;

    button.style.position = 'relative';
    button.style.overflow = 'hidden';
    button.appendChild(ripple);

    setTimeout(() => {
        ripple.remove();
    }, 600);
}

// Add ripple effect to all buttons
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('button, .category-btn');
    buttons.forEach(button => {
        button.addEventListener('click', createRipple);
    });
});