import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import validator from "validator";
import mongoose from "mongoose"; // Added for ObjectId validation and transactions
import userModel from "../models/userModel.js";
import doctorModel from "../models/doctorModel.js";
import appointmentModel from "../models/appointmentModel.js";
import { v2 as cloudinary } from "cloudinary";
import stripe from "stripe";
import razorpay from "razorpay";
import crypto from "crypto"; // Added for Razorpay signature verification

// Gateway Initialize
const stripeInstance = new stripe(process.env.STRIPE_SECRET_KEY);
const razorpayInstance = new razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// API to register user
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Checking for all data to register user
        if (!name || !email || !password) {
            return res.json({ success: false, message: "Missing Details" });
        }

        // Validating email format
        if (!validator.isEmail(email)) {
            return res.json({ success: false, message: "Please enter a valid email" });
        }

        // Validating strong password
        if (password.length < 8) {
            return res.json({ success: false, message: "Please enter a strong password" });
        }

        // Check for duplicate email
        const existingUser = await userModel.findOne({ email });
        if (existingUser) {
            return res.json({ success: false, message: "Email already in use" });
        }

        // Hashing user password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userData = {
            name,
            email,
            password: hashedPassword,
        };

        const newUser = new userModel(userData);
        const user = await newUser.save();
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" }); // Added expiry

        res.json({ success: true, token });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to login user
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await userModel.findOne({ email });

        if (!user) {
            return res.json({ success: false, message: "User does not exist" });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" }); // Added expiry
            res.json({ success: true, token });
        } else {
            res.json({ success: false, message: "Invalid credentials" });
        }
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to get user profile data
const getProfile = async (req, res) => {
    try {
        const { userId } = req.body;

        // Validate userId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.json({ success: false, message: "Invalid user ID" });
        }

        const userData = await userModel.findById(userId).select("-password");
        if (!userData) {
            return res.json({ success: false, message: "User not found" });
        }

        res.json({ success: true, userData });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to update user profile
const updateProfile = async (req, res) => {
    try {
        const { userId, name, phone, address, dob, gender } = req.body;
        const imageFile = req.file;

        if (!name || !phone || !dob || !gender) {
            return res.json({ success: false, message: "Data Missing" });
        }

        // Validate userId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.json({ success: false, message: "Invalid user ID" });
        }

        // Parse address safely
        const parsedAddress = typeof address === "string" ? JSON.parse(address) : address;

        await userModel.findByIdAndUpdate(userId, {
            name,
            phone,
            address: parsedAddress,
            dob,
            gender,
        });

        if (imageFile) {
            const imageUpload = await cloudinary.uploader.upload(imageFile.path, { resource_type: "image" });
            const imageURL = imageUpload.secure_url;
            await userModel.findByIdAndUpdate(userId, { image: imageURL });
        }

        res.json({ success: true, message: "Profile Updated" });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to book appointment
// const bookAppointment = async (req, res) => {
//     const session = await mongoose.startSession(); // Transaction start
//     session.startTransaction();
//     try {
//         const { userId, docId, slotDate, slotTime } = req.body;
//         console.log(req.body)

//         // Validate IDs
//         if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(docId)) {
//             throw new Error("Invalid user or doctor ID");
//         }

//         const docData = await doctorModel.findById(docId).select("-password");
//         if (!docData) {
//             throw new Error("Doctor not found");
//         }
//         if (!docData.available) {
//             throw new Error("Doctor Not Available");
//         }

//         let slots_booked = docData.slots_booked;

//         // Checking for slot availability
//         if (slots_booked[slotDate]) {
//             if (slots_booked[slotDate].includes(slotTime)) {
//                 throw new Error("Slot Not Available");
//             } else {
//                 slots_booked[slotDate].push(slotTime);
//             }
//         } else {
//             slots_booked[slotDate] = [];
//             slots_booked[slotDate].push(slotTime);
//         }

//         const userData = await userModel.findById(userId).select("-password");
//         delete docData.slots_booked;

//         const appointmentData = {
//             userId,
//             docId,
//             userData,
//             docData,
//             amount: docData.fees,
//             slotTime,
//             slotDate,
//             date: Date.now(),
//         };

//         const newAppointment = new appointmentModel(appointmentData);
//         await newAppointment.save({ session });

//         await doctorModel.findByIdAndUpdate(docId, { slots_booked }, { session });

//         await session.commitTransaction();
//         res.json({ success: true, message: "Appointment Booked" });
//     } catch (error) {
//         await session.abortTransaction();
//         console.log(error);
//         res.json({ success: false, message: error.message });
//     } finally {
//         session.endSession();
//     }
// };
const bookAppointment = async (req, res) => {
    try {
        const { userId, docId, slotDate, slotTime } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(docId)) {
            throw new Error("Invalid user or doctor ID");
        }

        const docData = await doctorModel.findById(docId).select("-password");
        if (!docData) {
            throw new Error("Doctor not found");
        }
        if (!docData.available) {
            throw new Error("Doctor Not Available");
        }

        let slots_booked = docData.slots_booked;

        if (slots_booked[slotDate]) {
            if (slots_booked[slotDate].includes(slotTime)) {
                throw new Error("Slot Not Available");
            } else {
                slots_booked[slotDate].push(slotTime);
            }
        } else {
            slots_booked[slotDate] = [];
            slots_booked[slotDate].push(slotTime);
        }

        const userData = await userModel.findById(userId).select("-password");
        delete docData.slots_booked;

        const appointmentData = {
            userId,
            docId,
            userData,
            docData,
            amount: docData.fees,
            slotTime,
            slotDate,
            date: Date.now(),
        };

        const newAppointment = new appointmentModel(appointmentData);
        await newAppointment.save();

        await doctorModel.findByIdAndUpdate(docId, { slots_booked });

        res.json({ success: true, message: "Appointment Booked" });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to cancel appointment
const cancelAppointment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { userId, appointmentId } = req.body;

        // Validate IDs
        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(appointmentId)) {
            throw new Error("Invalid user or appointment ID");
        }

        const appointmentData = await appointmentModel.findById(appointmentId);
        if (!appointmentData) {
            throw new Error("Appointment not found");
        }

        if (appointmentData.userId.toString() !== userId) {
            throw new Error("Unauthorized action");
        }

        await appointmentModel.findByIdAndUpdate(appointmentId, { cancelled: true }, { session });

        const { docId, slotDate, slotTime } = appointmentData;
        const doctorData = await doctorModel.findById(docId);

        let slots_booked = doctorData.slots_booked;
        slots_booked[slotDate] = slots_booked[slotDate].filter((e) => e !== slotTime);

        await doctorModel.findByIdAndUpdate(docId, { slots_booked }, { session });

        await session.commitTransaction();
        res.json({ success: true, message: "Appointment Cancelled" });
    } catch (error) {
        await session.abortTransaction();
        console.log(error);
        res.json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

// API to get user appointments
const listAppointment = async (req, res) => {
    try {
        const { userId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.json({ success: false, message: "Invalid user ID" });
        }

        const appointments = await appointmentModel.find({ userId });
        res.json({ success: true, appointments });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to make payment with Razorpay
const paymentRazorpay = async (req, res) => {
    try {
        const { appointmentId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
            return res.json({ success: false, message: "Invalid appointment ID" });
        }

        const appointmentData = await appointmentModel.findById(appointmentId);
        if (!appointmentData || appointmentData.cancelled) {
            return res.json({ success: false, message: "Appointment Cancelled or not found" });
        }

        const options = {
            amount: appointmentData.amount * 100,
            currency: process.env.CURRENCY || "INR", // Default to INR if undefined
            receipt: appointmentId,
        };

        const order = await razorpayInstance.orders.create(options);
        res.json({ success: true, order });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to verify Razorpay payment
const verifyRazorpay = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        // Verify signature
        const generatedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        if (generatedSignature !== razorpay_signature) {
            return res.json({ success: false, message: "Payment verification failed" });
        }

        const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id);
        if (orderInfo.status === "paid") {
            await appointmentModel.findByIdAndUpdate(orderInfo.receipt, { payment: true });
            res.json({ success: true, message: "Payment Successful" });
        } else {
            res.json({ success: false, message: "Payment Failed" });
        }
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to make payment with Stripe
const paymentStripe = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const { origin } = req.headers;

        if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
            return res.json({ success: false, message: "Invalid appointment ID" });
        }

        const appointmentData = await appointmentModel.findById(appointmentId);
        if (!appointmentData || appointmentData.cancelled) {
            return res.json({ success: false, message: "Appointment Cancelled or not found" });
        }

        const currency = (process.env.CURRENCY || "IN").toLowerCase(); // Default to USD
        const line_items = [
            {
                price_data: {
                    currency,
                    product_data: {
                        name: "Appointment Fees",
                    },
                    unit_amount: appointmentData.amount * 100,
                },
                quantity: 1,
            },
        ];

        const session = await stripeInstance.checkout.sessions.create({
            success_url: `${origin || "http://localhost:3000"}/verify?success=true&appointmentId=${appointmentData._id}`,
            cancel_url: `${origin || "http://localhost:3000"}/verify?success=false&appointmentId=${appointmentData._id}`,
            line_items: line_items,
            mode: "payment",
        });

        res.json({ success: true, session_url: session.url });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to verify Stripe payment
const verifyStripe = async (req, res) => {
    try {
        const { appointmentId, success } = req.body;

        if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
            return res.json({ success: false, message: "Invalid appointment ID" });
        }

        const appointmentData = await appointmentModel.findById(appointmentId);
        if (!appointmentData) {
            return res.json({ success: false, message: "Appointment not found" });
        }

        // Verify Stripe session server-side instead of trusting frontend success param
        const session = await stripeInstance.checkout.sessions.retrieve(appointmentData._id.toString());
        if (session.payment_status === "paid" && success === "true") {
            await appointmentModel.findByIdAndUpdate(appointmentId, { payment: true });
            return res.json({ success: true, message: "Payment Successful" });
        }

        res.json({ success: false, message: "Payment Failed or Not Completed" });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

export {
    loginUser,
    registerUser,
    getProfile,
    updateProfile,
    bookAppointment,
    listAppointment,
    cancelAppointment,
    paymentRazorpay,
    verifyRazorpay,
    paymentStripe,
    verifyStripe,
};