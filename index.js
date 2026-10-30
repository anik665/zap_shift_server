const express = require("express");

const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.DB_STRIPE_KEY);
const cors = require("cors");
const port = 3000;

const crypto = require("crypto");
//firebase admin initialization
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("./zapship-3d7f9-firebase-adminsdk-fbsvc-32d39afb19.json");

initializeApp({
  credential: cert(serviceAccount),
});
const auth = getAuth();

const generateTrackingId = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `ZS-${date}-${random}`;
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middlewere
app.use(express.json());
app.use(cors());

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;
  // console.log("token", token);
  if (!token) {
    return res
      .status(401)
      .send({ success: false, message: "Unauthorized access" });
  }

  const idToken = token.split(" ")[1];
  try {
    const decoded = await auth.verifyIdToken(idToken);
    // console.log("decoded", decoded);
    req.decodeEmail = decoded.email;
    next();
  } catch (error) {
    return res
      .status(401)
      .send({ success: false, message: "Unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.p8lzuaz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    const db = client.db("zap_shift_db");
    const parcelsCollections = db.collection("parcel");
    const paymentsCollections = db.collection("payments");

    // parcels api

    app.post("/parcel", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      console.log(parcel, "parcel Data");
      const result = await parcelsCollections.insertOne(parcel);
      res.send(result);
    });
    app.get("/parcel", async (req, res) => {
      const email = req.query.email;
      console.log("1. Email:", email);
      const query = {};
      if (email) {
        query.senderEmail = email;
      }
      const option = { sort: { createdAt: -1 } };
      const cursor = await parcelsCollections.find(query, option).toArray();
      res.send(cursor);
    });
    // for payment status update

    app.get("/payment/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.findOne(query);
      res.send(result);
    });

    app.delete("/parcel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.deleteOne(query);
      res.send(result);
    });

    //for payment intent

    app.post("/payment-cheakout-session", async (req, res) => {
      const { paymentInfo } = req.body;

      // ১. যদি ফ্রন্টএন্ড থেকে নাম বা ঠিকানা মিসিং থাকে, তবে সরাসরি ডাটাবেজ থেকে পার্সেল এনে ব্যাকএন্ডেই ফিলাপ করে নিন
      let recipientName = paymentInfo.recipientName;
      let recipientPhone = paymentInfo.recipientPhone;
      let recipientAddress = paymentInfo.recipientAddress;

      if (!recipientName && paymentInfo.parcelId) {
        const parcelDoc = await parcelsCollections.findOne({
          _id: new ObjectId(paymentInfo.parcelId),
        });
        if (parcelDoc) {
          recipientName = parcelDoc.receiverName || parcelDoc.recipientName;
          recipientPhone = parcelDoc.receiverPhone || parcelDoc.recipientPhone;
          recipientAddress =
            parcelDoc.receiverAddress || parcelDoc.recipientAddress;
        }
      }

      const amount = parseInt(paymentInfo.cost) * 100; // Convert to paisa
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
          recipientName: recipientName || "",
          recipientPhone: recipientPhone || "",
          recipientAddress: recipientAddress || "",
        },
        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.DB_SITE_URL}/dashbord/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.DB_SITE_URL}/dashbord/payment-cancel`,
      });

      res.send({ url: session.url });
    });

    // old one

    // app.post("/create-checkout-session", async (req, res) => {
    //   const { paymentInfo } = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100; // Convert to cents
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: "bdt",
    //           unit_amount: amount,

    //           product_data: {
    //             name: paymentInfo.parcelName,
    //           },
    //         },
    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: "payment",
    //     metadata: {
    //       parcelId: paymentInfo.parcelId,
    //       parcelName: paymentInfo.parcelName,
    //       recipientName: paymentInfo.recipientName,
    //       recipientPhone: paymentInfo.recipientPhone,
    //       recipientAddress: paymentInfo.recipientAddress,
    //     },
    //     success_url: `${process.env.DB_SITE_URL}/dashbord/payment-success`,
    //     cancel_url: `${process.env.DB_SITE_URL}/dashbord/payment-cancel`,
    //   });
    //   console.log(session, "session");
    //   res.send({ url: session.url });
    // });
    app.patch("/payment-success", async (req, res) => {
      const { session_id } = req.query;

      if (!session_id) {
        return res
          .status(400)
          .send({ success: false, message: "Session ID required" });
      }

      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status === "paid") {
        const parcelId = session.metadata.parcelId;
        const query = { _id: new ObjectId(parcelId) };

        // ১. প্রথমে ডাটাবেজ থেকে পার্সেলটি খুঁজুন
        const existingParcel = await parcelsCollections.findOne(query);

        // ২. আগের ট্র্যাকিং আইডি থাকলে সেটি রাখুন, না থাকলে নতুন বানান
        const trackingId = existingParcel?.trackingId || generateTrackingId();

        const updateDoc = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };
        const result = await parcelsCollections.updateOne(query, updateDoc);

        // ৩. পেমেন্ট রেকর্ড ইতিমধ্যেই তৈরি করা হয়েছে কিনা চেক করুন (Duplicate предотвратить করতে)
        const existingPayment = await paymentsCollections.findOne({
          transactionId: session.payment_intent,
        });

        if (!existingPayment) {
          const paymentData = {
            amount: session.amount_total / 100,
            currency: session.currency,
            transactionId: session.payment_intent,
            trackingId: trackingId,
            recipientName: session.metadata.recipientName,
            recipientPhone: session.metadata.recipientPhone,
            recipientAddress: session.metadata.recipientAddress,
            parcelId: session.metadata.parcelId,
            customerEmail: session.customer_email,
            paymentStatus: session.payment_status,
            paymentAt: new Date(),
            parcelName: session.metadata.parcelName,
          };
          await paymentsCollections.insertOne(paymentData);
        }

        return res.send({
          success: true,
          message: "Payment successful",
          trackingId: trackingId,
          transactionId: session.payment_intent,
        });
      }

      res.send({ success: false, message: "Payment failed" });
    });

    //payment history api
    app.get("/payment-history", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { customerEmail: email };
      if (email !== req.decodeEmail) {
        return res
          .status(403)
          .send({ success: false, message: "Forbidden access" });
      }

      const cursor = paymentsCollections.find(query);
      const result = await cursor.toArray();
      // console.log(result, "payment history");
      res.send(result);
    });

    // app.get("/clean-duplicate-payments", async (req, res) => {
    //   try {
    //     // ১. ডুপ্লিকেট transactionId চিহ্নিত করা
    //     const duplicates = await paymentsCollections
    //       .aggregate([
    //         {
    //           $group: {
    //             _id: "$transactionId", // transactionId দিয়ে গ্রুপ করা
    //             count: { $sum: 1 },
    //             docs: { $push: "$_id" }, // সবগুলোর ObjectId লিস্টে রাখা
    //           },
    //         },
    //         {
    //           $match: {
    //             count: { $gt: 1 }, // একের অধিক থাকলে সেগুলাই ডুপ্লিকেট
    //           },
    //         },
    //       ])
    //       .toArray();

    //     let deletedCount = 0;

    //     // ২. প্রথমটি রেখে বাকিগুলো মুছে ফেলা
    //     for (const doc of duplicates) {
    //       const idsToDelete = doc.docs.slice(1); // Index 0 রেখে বাকিগুলো নেওয়া হলো
    //       const result = await paymentsCollections.deleteMany({
    //         _id: { $in: idsToDelete },
    //       });
    //       deletedCount += result.deletedCount;
    //     }

    //     res.send({
    //       success: true,
    //       message: `${deletedCount}টি ডুপ্লিকেট পেমেন্ট মুছে ফেলা হয়েছে।`,
    //     });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ success: false, message: error.message });
    //   }
    // });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("zap shif shifting");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
