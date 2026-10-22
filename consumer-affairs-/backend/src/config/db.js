const mongoose = require('mongoose');
const { MONGO_URI } = require('./env');

let gridFSBucket;

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 2000,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Initialize GridFS bucket
    gridFSBucket = new mongoose.mongo.GridFSBucket(conn.connection.db, {
      bucketName: 'uploads'
    });
    
  } catch (error) {
    console.warn(`Local MongoDB connection failed (${error.message}). Attempting in-memory MongoDB fallback...`);
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();
      const conn = await mongoose.connect(uri);
      console.log(`✓ In-Memory MongoDB Started & Connected: ${uri}`);
      
      gridFSBucket = new mongoose.mongo.GridFSBucket(conn.connection.db, {
        bucketName: 'uploads'
      });
      
      // Auto seed initial data
      const seed = require('../utils/seedData');
      await seed();
    } catch (fallbackError) {
      console.error(`Error with in-memory MongoDB fallback: ${fallbackError.message}`);
      process.exit(1);
    }
  }
};

/**
 * Binds the GridFS bucket to an existing connection.
 *
 * connectDB does this itself; this is exported so a test (or any caller that
 * manages its own connection) can enable file storage without re-running the
 * whole connect-and-seed path.
 */
const initGridFSBucket = (connection) => {
  const db = (connection && connection.db) || mongoose.connection.db;
  if (!db) throw new Error('Cannot initialise GridFS before a database connection exists.');

  gridFSBucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
  return gridFSBucket;
};

const getGridFSBucket = () => {
  if (!gridFSBucket) {
    throw new Error('GridFSBucket has not been initialized. Please connect to MongoDB first.');
  }
  return gridFSBucket;
};

module.exports = { connectDB, getGridFSBucket, initGridFSBucket };
