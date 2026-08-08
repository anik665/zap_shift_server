# 🚚 ZapShift Server

Backend server for **ZapShift**, a courier and parcel delivery management application.

This server handles parcel-related API requests and stores application data in MongoDB.

## 🛠️ Technologies Used

- Node.js
- Express.js
- MongoDB
- MongoDB Node.js Driver
- CORS
- dotenv
- Nodemon

## 📁 Project Structure

```text
zap-shift-server/
│
├── index.js
├── .env
├── package.json
├── package-lock.json
└── README.md
```

## ⚙️ Features

- Express.js server setup
- MongoDB Atlas integration
- CORS configuration
- JSON request body handling
- Parcel creation API
- Environment variable configuration
- Nodemon development setup

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/anik665/zap_shift_server
```

### 2. Go to the project directory

```bash
cd zap-shift-server
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file in the root directory:

```env
DB_USER=your_mongodb_username
DB_PASSWORD=your_mongodb_password
```

> Never upload your `.env` file or database credentials to GitHub.

### 5. Run the server

For development:

```bash
npm run dev
```

Or:

```bash
node index.js
```

The server will run on:

```text
http://localhost:3000
```

## 🔌 API

### Create Parcel

**POST**

```text
/parcel
```

Full URL:

```text
http://localhost:3000/parcel
```

### Request Body

```json
{
  "parcelName": "Laptop",
  "parcelWeight": 2.5,
  "senderDistrict": "Dhaka",
  "receiverDistrict": "Rajshahi"
}
```

### Example Response

```json
{
  "acknowledged": true,
  "insertedId": "..."
}
```

## 🗄️ Database

The application uses **MongoDB Atlas**.

Database:

```text
zap_shift_db
```

Collection:

```text
parcel
```

## 🔐 Environment Variables

The following environment variables are required:

| Variable      | Description               |
| ------------- | ------------------------- |
| `DB_USER`     | MongoDB database username |
| `DB_PASSWORD` | MongoDB database password |

## 🧪 API Testing

You can test the API using:

- Thunder Client
- Postman
- Insomnia

Example:

```text
POST http://localhost:3000/parcel
```

with JSON body:

```json
{
  "parcelName": "Test Parcel",
  "parcelWeight": 2,
  "senderDistrict": "Dhaka",
  "receiverDistrict": "Rajshahi"
}
```

## 📌 Current Status

The backend is currently under development.

Upcoming features may include:

- User management
- Authentication
- Parcel tracking
- Booking management
- Payment integration
- Delivery status management
- Admin APIs

## 👨‍💻 Developer

**Anik Ghosh**

ZapShift — Courier & Parcel Delivery Platform
