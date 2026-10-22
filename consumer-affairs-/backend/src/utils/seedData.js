const User = require('../models/User');
const Product = require('../models/Product');
const Inspection = require('../models/Inspection');
const RulePack = require('../models/RulePack');
const rulePackData = require('../data/rulePack_v1.json');

const seedData = async () => {
  try {
    const existingUsers = await User.countDocuments();
    if (existingUsers > 0) {
      return;
    }

    console.log('Seeding initial demo data for testing...');

    // 1. Seed Users
    const seniorInspector = await User.create({
      email: 'inspector@lmverify.gov.in',
      passwordHash: 'Password123!',
      role: 'senior_inspector',
      displayName: 'Rajesh Kumar (Senior Inspector)',
      jurisdiction: 'Delhi Central',
      isActive: true
    });

    const controller = await User.create({
      email: 'admin@lmverify.gov.in',
      passwordHash: 'Password123!',
      role: 'controller',
      displayName: 'Anita Sharma (Controller)',
      jurisdiction: 'National',
      isActive: true
    });

    // 2. Seed RulePack
    await RulePack.create({
      version: '1.0.0',
      effectiveFrom: new Date('2011-04-01'),
      isActive: true,
      rules: Array.isArray(rulePackData) ? rulePackData : rulePackData.rules || [],
      createdBy: controller._id
    });

    // 3. Seed Sample Products
    const biscuit = await Product.create({
      gtin: '8901030384912',
      brand: 'Parle-G',
      genericName: 'Biscuits',
      category: 'biscuits_bread',
      declarations: {
        manufacturer: 'Parle Products Pvt Ltd, Mumbai',
        genericName: 'Biscuits',
        netQuantity: '200 g',
        mrp: 'Rs 40.00 incl. of all taxes',
        date: '08/2026'
      },
      complianceHistory: []
    });

    const tea = await Product.create({
      gtin: '8901058852319',
      brand: 'Taj Mahal',
      genericName: 'Tea',
      category: 'tea_coffee',
      declarations: {
        manufacturer: 'Hindustan Unilever Ltd',
        genericName: 'Tea',
        netQuantity: '250 g',
        mrp: 'Rs 150.00',
        date: '07/2026'
      },
      complianceHistory: []
    });

    // 4. Seed Sample Inspections
    const inspection1 = await Inspection.create({
      ref: 'INS-2401',
      officerId: seniorInspector._id,
      productId: biscuit._id,
      geo: { lat: 28.6139, lng: 77.2090 },
      capturedAt: new Date(),
      status: 'adjudicated',
      verdict: 'non_compliant',
      remarks: 'Failed numeral height on quantity declaration and clear space margins.',
      rulePackVersion: '1.0.0',
      extracted: {
        manufacturer: { name: 'Parle Products Pvt Ltd', address: 'Mumbai, MH, India', qualifier: 'manufactured by' },
        genericName: 'Biscuits',
        netQuantity: { value: 200, unit: 'g', raw: '200 g' },
        monthYear: { month: '08', year: '2026', raw: '08/2026' },
        mrp: { value: 40, wording: 'MRP Rs 40 incl. of all taxes', raw: 'MRP Rs 40 incl. of all taxes' },
        consumerCare: { name: 'Consumer Care Cell', address: 'Mumbai', phone: '1800222211', email: 'care@parle.biz' }
      },
      results: [
        { ruleId: 'R6_1_A', citation: 'Rule 6(1)(a)', check: 'Manufacturer / packer / importer present', found: 'Parle Products Pvt Ltd, Mumbai', required: 'Mandatory', verdict: 'PASS', confidence: 0.95 },
        { ruleId: 'R6_1_B', citation: 'Rule 6(1)(b)', check: 'Common or generic name', found: 'Biscuits', required: 'Mandatory', verdict: 'PASS', confidence: 0.98 },
        { ruleId: 'R6_1_C', citation: 'Rule 6(1)(c)', check: 'Net quantity declared', found: '200 g', required: 'Standard unit', verdict: 'PASS', confidence: 0.96 },
        { ruleId: 'R6_1_D', citation: 'Rule 6(1)(d)', check: 'Month & year of packing', found: '08/2026', required: 'Mandatory', verdict: 'PASS', confidence: 0.92 },
        { ruleId: 'R6_1_E', citation: 'Rule 6(1)(e)', check: 'Retail sale price', found: 'MRP Rs 40 incl. of all taxes', required: 'Prescribed form', verdict: 'PASS', confidence: 0.94 },
        { ruleId: 'R6_2', citation: 'Rule 6(2)', check: 'Consumer care details', found: 'All 4 fields present', required: 'Name, address, phone, email', verdict: 'PASS', confidence: 0.91 },
        { ruleId: 'R7_2_T1', citation: 'Rule 7(2)', check: 'Numeral height', found: '0.8 mm measured', required: '1 mm min (up to 200g)', verdict: 'FAIL', confidence: 0.85, measuredValue: '0.8mm', prescribedValue: '1mm' },
        { ruleId: 'R8_1', citation: 'Rule 8(1)', check: 'Clear space around quantity', found: '1.2x height at left', required: '2x height left and right', verdict: 'FAIL', confidence: 0.82 }
      ],
      penalties: { total: 4000, breakdown: [{ ruleId: 'R7_2_T1', amount: 2000 }, { ruleId: 'R8_1', amount: 2000 }] }
    });

    const inspection2 = await Inspection.create({
      ref: 'INS-2402',
      officerId: seniorInspector._id,
      productId: tea._id,
      geo: { lat: 28.6139, lng: 77.2090 },
      capturedAt: new Date(Date.now() - 3600000),
      status: 'adjudicated',
      verdict: 'compliant',
      remarks: 'All mandatory declarations verified and fully compliant.',
      rulePackVersion: '1.0.0',
      extracted: {
        manufacturer: { name: 'Hindustan Unilever Ltd', address: 'Mumbai 400099', qualifier: 'manufactured by' },
        genericName: 'Tea',
        netQuantity: { value: 250, unit: 'g', raw: '250 g' },
        monthYear: { month: '07', year: '2026', raw: '07/2026' },
        mrp: { value: 150, wording: 'MRP Rs 150.00 incl. of all taxes', raw: 'MRP Rs 150.00 incl. of all taxes' },
        consumerCare: { name: 'Consumer Care Executive', address: 'PO Box 14760, Mumbai', phone: '18001022221', email: 'lever.care@unilever.com' }
      },
      results: [
        { ruleId: 'R6_1_A', citation: 'Rule 6(1)(a)', check: 'Manufacturer / packer / importer present', found: 'Hindustan Unilever Ltd', required: 'Mandatory', verdict: 'PASS', confidence: 0.98 },
        { ruleId: 'R6_1_B', citation: 'Rule 6(1)(b)', check: 'Common or generic name', found: 'Tea', required: 'Mandatory', verdict: 'PASS', confidence: 0.99 },
        { ruleId: 'R6_1_C', citation: 'Rule 6(1)(c)', check: 'Net quantity declared', found: '250 g', required: 'Standard unit', verdict: 'PASS', confidence: 0.97 },
        { ruleId: 'R6_1_D', citation: 'Rule 6(1)(d)', check: 'Month & year of packing', found: '07/2026', required: 'Mandatory', verdict: 'PASS', confidence: 0.94 },
        { ruleId: 'R6_1_E', citation: 'Rule 6(1)(e)', check: 'Retail sale price', found: 'MRP Rs 150.00 incl. of all taxes', required: 'Prescribed form', verdict: 'PASS', confidence: 0.96 },
        { ruleId: 'R6_2', citation: 'Rule 6(2)', check: 'Consumer care details', found: 'All fields present', required: 'Name, address, phone, email', verdict: 'PASS', confidence: 0.95 }
      ],
      penalties: { total: 0, breakdown: [] }
    });

    // Update product compliance histories
    biscuit.complianceHistory.push({
      inspectionId: inspection1._id,
      verdict: 'non_compliant',
      date: inspection1.createdAt,
      violations: 2,
      ref: 'INS-2401'
    });
    await biscuit.save();

    tea.complianceHistory.push({
      inspectionId: inspection2._id,
      verdict: 'compliant',
      date: inspection2.createdAt,
      violations: 0,
      ref: 'INS-2402'
    });
    await tea.save();

    console.log('✓ Demo data seeded successfully:');
    console.log('   - Inspector: inspector@lmverify.gov.in / Password123!');
    console.log('   - Admin: admin@lmverify.gov.in / Password123!');
    console.log('   - 2 Products & 2 Sample Inspections (1 Passed, 1 Failed)');
  } catch (err) {
    console.error('Error seeding demo data:', err.message);
  }
};

module.exports = seedData;
