import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../context/AuthContext';
import { DailyOrder, OrderItem } from '../types';
import { IndianRupee, ShoppingCart, CheckCircle, Clock, FileText, FileDown, FileSpreadsheet, Loader2, User, Share2, AlertCircle, Check, Lock, Key, PlugZap } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import hindVadodaraRegularBase64 from '../assets/HindVadodaraRegularBase64.txt?raw';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface CustomerStatement {
  customerId: string;
  customerName: string;
  orders: DailyOrder[];
  totalAmount: number;
  totalPaid: number;
  pendingAmount: number;
}

interface StatementResult {
  customerStatements: CustomerStatement[];
  grandTotalAmount: number;
  grandTotalPaid: number;
  grandTotalPending: number;
  totalOrders: number;
}

interface DailySummaryForStatement {
  date: string;
  totalAmount: number;
  totalPaid: number;
  balance: number;
  allItems: OrderItem[];
}

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const getDailySummariesForStatement = (orders: DailyOrder[]): DailySummaryForStatement[] => {
    const groupedByDate = orders.reduce((acc, order) => {
        const date = order.date;
        if (!acc[date]) {
            acc[date] = {
                date,
                totalAmount: 0,
                totalPaid: 0,
                allItems: [],
            };
        }
        const summary = acc[date];
        summary.totalAmount += order.total_amount;
        summary.totalPaid += order.amount_paid || 0;
        summary.allItems.push(...order.items);
        return acc;
    }, {} as Record<string, Omit<DailySummaryForStatement, 'balance'>>);

    return Object.values(groupedByDate).map(summary => {
        const aggregatedItems: Record<string, OrderItem> = {};
        summary.allItems.forEach(item => {
            const key = `${item.product_id}-${item.price}`;
            if (aggregatedItems[key]) {
                aggregatedItems[key].quantity += item.quantity;
                aggregatedItems[key].total += item.total;
            } else {
                aggregatedItems[key] = { ...item };
            }
        });

        return {
            ...summary,
            allItems: Object.values(aggregatedItems).sort((a, b) => a.product_name.localeCompare(b.product_name)),
            balance: summary.totalAmount - summary.totalPaid,
        };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

const getDatesInRange = (start: string, end: string): string[] => {
    const dates = [];
    const currentDate = new Date(start);
    const endDate = new Date(end);
    currentDate.setUTCHours(0,0,0,0);
    endDate.setUTCHours(0,0,0,0);

    while (currentDate <= endDate) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
};

const Statement: React.FC = () => {
  const { orders, customers, dataLoading } = useAuth();

  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedCustomerId, setSelectedCustomerId] = useState('all');
  const [generatedStatement, setGeneratedStatement] = useState<StatementResult | null>(null);

  const [sheetApiUrl, setSheetApiUrl] = useLocalStorage('googleSheetApiUrl', '');
  const [sheetApiUser, setSheetApiUser] = useLocalStorage('sheetApiUser', '');
  const [sheetApiPass, setSheetApiPass] = useLocalStorage('sheetApiPass', '');
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const generateStatementData = (forCustomerId: string, dateRange: { start: string, end: string }): StatementResult => {
    const filteredOrders = orders.filter(order => {
        const orderDate = new Date(order.date);
        const start = new Date(dateRange.start);
        const end = new Date(dateRange.end);
        
        orderDate.setUTCHours(0, 0, 0, 0);
        start.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(0, 0, 0, 0);

        const isDateInRange = orderDate >= start && orderDate <= end;
        const isCustomerMatch = forCustomerId === 'all' || order.customer_id === forCustomerId;
        
        return isDateInRange && isCustomerMatch;
    });

    const ordersByCustomer = filteredOrders.reduce((acc, order) => {
        (acc[order.customer_id] = acc[order.customer_id] || []).push(order);
        return acc;
    }, {} as Record<string, DailyOrder[]>);

    const customerStatements: CustomerStatement[] = Object.entries(ordersByCustomer).map(([customerId, customerOrders]) => {
        const totalAmount = customerOrders.reduce((sum, o) => sum + o.total_amount, 0);
        const totalPaid = customerOrders.reduce((sum, o) => sum + (o.amount_paid || 0), 0);
        return {
            customerId,
            customerName: customerOrders[0]?.customer_name || 'Unknown',
            orders: customerOrders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
            totalAmount,
            totalPaid,
            pendingAmount: totalAmount - totalPaid,
        };
    });

    const grandTotalAmount = customerStatements.reduce((sum, cs) => sum + cs.totalAmount, 0);
    const grandTotalPaid = customerStatements.reduce((sum, cs) => sum + cs.totalPaid, 0);
    
    return {
        customerStatements: customerStatements.sort((a, b) => a.customerName.localeCompare(b.customerName)),
        grandTotalAmount,
        grandTotalPaid,
        grandTotalPending: grandTotalAmount - grandTotalPaid,
        totalOrders: filteredOrders.length,
    };
  };

  const handleGenerateStatement = () => {
    setGeneratedStatement(generateStatementData(selectedCustomerId, { start: startDate, end: endDate }));
  };

  const handleDownloadFullReport = () => {
    const dates = getDatesInRange(startDate, endDate);
    const wb = XLSX.utils.book_new();

    dates.forEach(date => {
        const reportDateOrders = orders.filter(order => order.date === date);

        if (reportDateOrders.length === 0) {
            const ws = XLSX.utils.aoa_to_sheet([[`No orders found for ${date}`]]);
            XLSX.utils.book_append_sheet(wb, ws, date);
            return;
        }

        const allOrdersData: (string | number | { t: string; v: string | number; s: any; })[][] = [
            ["Customer Name", "Product Name", "Quantity", "Unit", "Price per Unit", "Total Price"],
        ];
        
        const ordersByCustomer = reportDateOrders.reduce((acc, order) => {
            (acc[order.customer_id] = acc[order.customer_id] || []).push(order);
            return acc;
        }, {} as Record<string, DailyOrder[]>);

        let grandTotal = 0;
        Object.values(ordersByCustomer).sort((a,b) => a[0].customer_name.localeCompare(b[0].customer_name)).forEach(customerOrders => {
            const customerName = customerOrders[0].customer_name;
            let customerTotal = 0;
            
            customerOrders.flatMap(order => order.items).forEach(item => {
                allOrdersData.push([
                    customerName,
                    item.product_name,
                    item.quantity,
                    item.unit,
                    item.price,
                    item.total
                ]);
                customerTotal += item.total;
            });

            allOrdersData.push(["", "", "", "", { t: 's', v: "Customer Total", s: { font: { bold: true } } }, { t: 'n', v: customerTotal, s: { font: { bold: true }, num_fmt: '"₹"#,##0.00' } }]);
            allOrdersData.push([]);
            grandTotal += customerTotal;
        });
        
        allOrdersData.push(["", "", "", "", { t: 's', v: "Grand Total", s: { font: { bold: true, sz: 14 } } }, { t: 'n', v: grandTotal, s: { font: { bold: true, sz: 14 }, num_fmt: '"₹"#,##0.00' } }]);
        
        const ws = XLSX.utils.aoa_to_sheet(allOrdersData);
        ws['!cols'] = [{wch: 25}, {wch: 30}, {wch: 10}, {wch: 10}, {wch: 15}, {wch: 15}];
        XLSX.utils.book_append_sheet(wb, ws, date);
    });

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    triggerDownload(blob, `Full_Report_${startDate}_to_${endDate}.xlsx`);
  };

  const handleDownloadPDF = () => {
    const statementToDownload = generateStatementData('all', { start: startDate, end: endDate });
    if (!statementToDownload || statementToDownload.totalOrders === 0) {
      alert("No data available to generate PDF for the selected date range.");
      return;
    }

    const doc = new jsPDF();
    
    if (hindVadodaraRegularBase64 && hindVadodaraRegularBase64.trim().length > 0) {
      try {
        let pureBase64 = hindVadodaraRegularBase64;
        const commaIndex = pureBase64.indexOf(',');
        if (commaIndex !== -1) {
          pureBase64 = pureBase64.substring(commaIndex + 1);
        }
        pureBase64 = pureBase64.replace(/[^A-Za-z0-9+/=]/g, '');

        doc.addFileToVFS('HindVadodara-Regular.ttf', pureBase64);
        doc.addFont('HindVadodara-Regular.ttf', 'HindVadodara', 'normal');
        doc.setFont('HindVadodara');
      } catch (e) {
        console.error("Failed to load custom font for PDF. Falling back to default.", e);
        doc.setFont('helvetica');
      }
    } else {
      console.warn("Gujarati font data not found. PDF will not render Gujarati characters correctly.");
      doc.setFont('helvetica');
    }

    doc.setFontSize(18);
    doc.text('Jay Goga Milk - Statement', 14, 22);
    doc.setFontSize(11);
    doc.text(`Period: ${startDate} to ${endDate}`, 14, 30);

    doc.setFontSize(14);
    doc.text('Overall Summary', 14, 45);
    doc.setFontSize(10);
    doc.text(`Total Order Value: ₹${statementToDownload.grandTotalAmount.toFixed(2)}`, 14, 52);
    doc.text(`Total Paid: ₹${statementToDownload.grandTotalPaid.toFixed(2)}`, 14, 58);
    doc.text(`Pending Amount: ₹${statementToDownload.grandTotalPending.toFixed(2)}`, 14, 64);

    let yPos = 75;

    statementToDownload.customerStatements.forEach(cs => {
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(`Customer: ${cs.customerName}`, 14, yPos);
        yPos += 7;

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Total: ₹${cs.totalAmount.toFixed(2)} | Paid: ₹${cs.totalPaid.toFixed(2)} | Pending: ₹${cs.pendingAmount.toFixed(2)}`, 14, yPos);
        yPos += 5;

        const dailySummaries = getDailySummariesForStatement(cs.orders);
        const tableColumn = ["Date", "Items", "Total", "Paid", "Balance"];
        const tableRows = dailySummaries.map(summary => [
            new Date(summary.date).toLocaleDateString('en-IN', { timeZone: 'UTC' }),
            summary.allItems.map(i => `${i.product_name} (x${i.quantity} @ ₹${i.price.toFixed(2)})`).join('\n'),
            `₹${summary.totalAmount.toFixed(2)}`,
            `₹${summary.totalPaid.toFixed(2)}`,
            `₹${summary.balance.toFixed(2)}`,
        ]);

        (doc as any).autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: yPos,
            theme: 'grid',
            headStyles: { fillColor: [2, 132, 199] }, // dairy-600
            styles: { font: 'HindVadodara', fontStyle: 'normal' },
        });

        yPos = (doc as any).lastAutoTable.finalY + 15;
    });

    const blob = doc.output('blob');
    triggerDownload(blob, `Statement_All_Customers_${startDate}_to_${endDate}.pdf`);
  };

  const handleDownloadExcel = () => {
    const statementToDownload = generateStatementData('all', { start: startDate, end: endDate });
    if (!statementToDownload || statementToDownload.totalOrders === 0) {
      alert("No data available to generate Excel for the selected date range.");
      return;
    }
    
    const ws_data: (string | number)[][] = [
      ["Jay Goga Milk - Statement"],
      [`Period: ${startDate} to ${endDate}`],
      [],
      ["Overall Summary"],
      ["Total Order Value", statementToDownload.grandTotalAmount],
      ["Total Paid", statementToDownload.grandTotalPaid],
      ["Pending Amount", statementToDownload.grandTotalPending],
      [],
    ];

    statementToDownload.customerStatements.forEach(cs => {
        ws_data.push([`Customer: ${cs.customerName}`]);
        ws_data.push(["Customer Total", cs.totalAmount, "Customer Paid", cs.totalPaid, "Customer Pending", cs.pendingAmount]);
        
        const dailySummaries = getDailySummariesForStatement(cs.orders);
        ws_data.push(["Date", "Items", "Total", "Paid", "Balance"]);
        dailySummaries.forEach(summary => {
            ws_data.push([
                new Date(summary.date).toLocaleDateString('en-IN', { timeZone: 'UTC' }),
                summary.allItems.map(i => `${i.product_name} (x${i.quantity} @ ₹${i.price.toFixed(2)})`).join(', '),
                summary.totalAmount,
                summary.totalPaid,
                summary.balance,
            ]);
        });
        ws_data.push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = [{wch:12}, {wch:40}, {wch:10}, {wch:10}, {wch:10}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    triggerDownload(blob, `Statement_All_Customers_${startDate}_to_${endDate}.xlsx`);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    setSyncStatus(null);

    if (!sheetApiUrl) {
        setTestStatus({ type: 'error', message: 'Please provide the Sheet API URL.' });
        setIsTesting(false);
        return;
    }

    const headers: HeadersInit = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (sheetApiUser && sheetApiPass) {
        headers['Authorization'] = 'Basic ' + btoa(`${sheetApiUser}:${sheetApiPass}`);
    }

    const testUrl = sheetApiUrl.split('?')[0] + '/count';

    try {
        const response = await fetch(testUrl, { method: 'GET', headers });
        const data = await response.json();

        if (!response.ok) {
            let errorMessage = `Request failed with status ${response.status}.`;
            if (data.error) {
                errorMessage = data.error;
            }
            if (response.status === 401) {
                errorMessage = 'Error 401: Unauthorized. Check credentials.';
            }
            throw new Error(errorMessage);
        }

        setTestStatus({ type: 'success', message: `Connection successful! Found ${data.rows} rows in the default sheet.` });
    } catch (error: any) {
        setTestStatus({ type: 'error', message: `Connection failed: ${error.message}` });
    } finally {
        setIsTesting(false);
    }
  };

  const handleSyncToGoogleSheet = async () => {
    setIsSyncing(true);
    setSyncStatus(null);
    setTestStatus(null);

    if (!sheetApiUrl) {
        setSyncStatus({ type: 'error', message: 'Please set your Google Sheet API URL first.' });
        setIsSyncing(false);
        return;
    }

    const headers: HeadersInit = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };
    if (sheetApiUser && sheetApiPass) {
        headers['Authorization'] = 'Basic ' + btoa(`${sheetApiUser}:${sheetApiPass}`);
    }

    try {
        const dates = getDatesInRange(startDate, endDate);
        const syncPromises = [];

        for (const date of dates) {
            const dailyOrders = orders.filter(order => order.date === date);
            if (dailyOrders.length === 0) continue;

            const customerDateSummary = new Map<string, { date: string; customerName: string; products: Map<string, number>; totalAmount: number; }>();
            for (const order of dailyOrders) {
                const key = `${order.date}-${order.customer_id}`;
                if (!customerDateSummary.has(key)) {
                    customerDateSummary.set(key, { date: order.date, customerName: order.customer_name, products: new Map<string, number>(), totalAmount: 0 });
                }
                const summary = customerDateSummary.get(key)!;
                summary.totalAmount += order.total_amount;
                for (const item of order.items) {
                    const currentQty = summary.products.get(item.product_name) || 0;
                    summary.products.set(item.product_name, currentQty + item.quantity);
                }
            }

            const dataToSync = Array.from(customerDateSummary.values()).map(summary => {
                const productsOrdered = Array.from(summary.products.entries()).map(([name, qty]) => `${name} (x${qty})`).join(', ');
                return {
                    'ID': `${summary.date}-${summary.customerName.replace(/\s+/g, '_')}`,
                    'Date': summary.date,
                    'Customer_Name': summary.customerName,
                    'Products_Ordered': productsOrdered,
                    'Total_Amount': summary.totalAmount,
                };
            }).sort((a, b) => a.Customer_Name.localeCompare(b.Customer_Name));

            if (dataToSync.length > 0) {
                const urlWithSheet = `${sheetApiUrl}?sheet=${date}`;
                const promise = fetch(urlWithSheet, {
                    method: 'PUT',
                    headers: headers,
                    body: JSON.stringify({ data: dataToSync })
                }).then(async response => {
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ error: 'Could not parse error response.' }));
                        return Promise.reject({ status: response.status, data: errorData, date });
                    }
                    return response.json();
                });
                syncPromises.push(promise);
            }
        }

        if (syncPromises.length === 0) {
            setSyncStatus({ type: 'success', message: 'No new data to sync in the selected date range.' });
            setIsSyncing(false);
            return;
        }

        const results = await Promise.allSettled(syncPromises);
        const successfulSyncs = results.filter(r => r.status === 'fulfilled').length;
        const failedSyncs = results.filter(r => r.status === 'rejected');

        if (failedSyncs.length === 0) {
            setSyncStatus({ type: 'success', message: `Successfully synced data for ${successfulSyncs} day(s)!` });
        } else {
            const firstError = (failedSyncs[0] as PromiseRejectedResult).reason;
            let errorMessage = 'An unexpected error occurred.';
            if (firstError.status) {
                if (firstError.status === 401) {
                    errorMessage = 'Error 401: Unauthorized. Please check your API Username and Password.';
                } else if (firstError.status === 405) {
                    errorMessage = 'Error 405: Method Not Allowed. This usually means the API URL is incorrect. Please ensure you are using the API URL from a service like SheetDB, not the Google Sheets browser URL.';
                } else if (firstError.data?.error) {
                    errorMessage = `Sync failed: ${firstError.data.error}`;
                } else {
                    errorMessage = `Sync failed with status ${firstError.status}.`;
                }
            }
            setSyncStatus({ type: 'error', message: `Synced ${successfulSyncs} of ${results.length} days. First error on sheet '${firstError.date}': ${errorMessage}` });
        }
    } catch (error) {
        console.error("Google Sheet sync failed:", error);
        setSyncStatus({ type: 'error', message: 'A general error occurred during the sync process.' });
    } finally {
        setIsSyncing(false);
    }
  };

  const grandStats = useMemo(() => {
    if (!generatedStatement) return [];
    return [
      { icon: IndianRupee, label: 'Grand Total Value', value: `₹${generatedStatement.grandTotalAmount.toFixed(2)}`, color: 'bg-blue-100 text-blue-600' },
      { icon: CheckCircle, label: 'Grand Total Paid', value: `₹${generatedStatement.grandTotalPaid.toFixed(2)}`, color: 'bg-green-100 text-green-600' },
      { icon: Clock, label: 'Grand Pending', value: `₹${generatedStatement.grandTotalPending.toFixed(2)}`, color: 'bg-orange-100 text-orange-600' },
      { icon: ShoppingCart, label: 'Total Orders', value: generatedStatement.totalOrders, color: 'bg-purple-100 text-purple-600' },
    ];
  }, [generatedStatement]);

  return (
    <Layout title="Statement">
      <div className="px-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl p-4 mb-6 shadow-sm border border-gray-100"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-4">Generate Statement</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-dairy-500"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-dairy-500"/>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-dairy-500">
                <option value="all">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <motion.button
              onClick={handleGenerateStatement}
              disabled={dataLoading}
              className="w-full bg-dairy-600 text-white py-3 rounded-lg font-medium flex justify-center items-center"
              whileTap={{ scale: 0.98 }}
            >
              {dataLoading ? <Loader2 className="animate-spin" /> : 'Generate Statement'}
            </motion.button>
          </div>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl p-4 mb-6 shadow-sm border border-gray-100"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-2">Full Report Download</h2>
          <p className="text-gray-600 text-sm mb-4">Downloads a detailed Excel report for the date range selected above, with each day in a separate sheet.</p>
          <motion.button
            onClick={handleDownloadFullReport}
            disabled={dataLoading}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-medium flex justify-center items-center space-x-2"
            whileTap={{ scale: 0.98 }}
          >
            {dataLoading ? <Loader2 className="animate-spin" /> : (
              <>
                <FileSpreadsheet size={20} />
                <span>Download Full Report (Excel)</span>
              </>
            )}
          </motion.button>
        </motion.div>

        <AnimatePresence>
          {generatedStatement && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="grid grid-cols-2 gap-4 mb-6">
                {grandStats.map((stat, index) => (
                  <motion.div key={stat.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.1 }} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <div className={`p-2 rounded-lg inline-block ${stat.color} mb-2`}><stat.icon size={20} /></div>
                    <p className="text-xl md:text-2xl font-bold text-gray-800 truncate">{stat.value}</p>
                    <p className="text-xs text-gray-600">{stat.label}</p>
                  </motion.div>
                ))}
              </div>

              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Statement Details</h3>
                  <p className="text-sm text-gray-500">Full report for all customers in the selected date range.</p>
                </div>
                <div className="flex space-x-2">
                  <motion.button onClick={handleDownloadPDF} className="flex items-center space-x-2 bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm font-medium" whileTap={{scale: 0.95}}><FileDown size={16}/><span>PDF</span></motion.button>
                  <motion.button onClick={handleDownloadExcel} className="flex items-center space-x-2 bg-green-50 text-green-700 px-3 py-2 rounded-lg text-sm font-medium" whileTap={{scale: 0.95}}><FileSpreadsheet size={16}/><span>Excel</span></motion.button>
                </div>
              </div>
              
              {generatedStatement.customerStatements.length > 0 ? (
                <div className="space-y-6">
                  {generatedStatement.customerStatements.map(cs => {
                    const dailySummaries = getDailySummariesForStatement(cs.orders);
                    return (
                      <div key={cs.customerId} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-4 pb-4 border-b">
                          <h3 className="text-lg font-bold text-gray-800 flex items-center"><User size={20} className="mr-2 text-dairy-700"/>{cs.customerName}</h3>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                          <div className="p-2 bg-gray-50 rounded-lg"><p className="text-xs text-gray-500">Total</p><p className="font-bold text-sm text-gray-800">₹{cs.totalAmount.toFixed(2)}</p></div>
                          <div className="p-2 bg-green-50 rounded-lg"><p className="text-xs text-green-700">Paid</p><p className="font-bold text-sm text-green-600">₹{cs.totalPaid.toFixed(2)}</p></div>
                          <div className="p-2 bg-red-50 rounded-lg"><p className="text-xs text-red-700">Pending</p><p className="font-bold text-sm text-red-600">₹{cs.pendingAmount.toFixed(2)}</p></div>
                        </div>
                        <div className="space-y-4">
                          {dailySummaries.map(summary => (
                            <div key={summary.date} className="bg-gray-50 rounded-lg p-3">
                              <div className="flex justify-between items-center mb-2">
                                <p className="font-semibold text-gray-700">{new Date(summary.date).toLocaleDateString('en-IN', { timeZone: 'UTC' })}</p>
                              </div>
                              <div className="text-xs text-gray-600 space-y-1 my-2 pl-2 border-l-2 border-dairy-200">
                                {summary.allItems.map((item, idx) => (
                                  <p key={idx}>{item.product_name} (x{item.quantity} @ ₹{item.price.toFixed(2)}) - Total: ₹{item.total.toFixed(2)}</p>
                                ))}
                              </div>
                              <div className="mt-2 pt-2 border-t space-y-1 text-sm">
                                <div className="flex justify-between"><span className="text-gray-600">Total:</span><span className="font-medium">₹{summary.totalAmount.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-600">Paid:</span><span className="font-medium text-green-600">₹{summary.totalPaid.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-600">Balance:</span><span className={`font-bold ${summary.balance <= 0 ? 'text-green-700' : 'text-red-600'}`}>₹{summary.balance.toFixed(2)}</span></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
                  <FileText className="mx-auto text-gray-300 mb-4" size={48} />
                  <p className="text-gray-600">No orders found for the selected criteria.</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-xl p-4 my-6 shadow-sm border border-gray-100"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-2">Google Sheets Sync</h2>
          <details className="mb-4">
            <summary className="cursor-pointer font-medium text-dairy-700 hover:text-dairy-800">Show Setup Instructions</summary>
            <div className="mt-2 text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
              <p className="mb-2">
                Syncs a customer summary for each day in the selected date range. Each day will be a separate sheet named <code className="font-mono">YYYY-MM-DD</code>. Requires a free account from a service like <a href="https://sheetdb.io" target="_blank" rel="noopener noreferrer" className="text-dairy-600 font-medium underline">SheetDB</a>.
              </p>
              <strong>Setup:</strong> Create a Google Sheet. The first row headers must be exactly: <br/>
              <code className="font-mono">ID</code>, <code className="font-mono">Date</code>, <code className="font-mono">Customer_Name</code>, <code className="font-mono">Products_Ordered</code>, <code className="font-mono">Total_Amount</code>
              <div className="mt-2 flex items-start">
                <Key size={14} className="mr-2 mt-0.5 text-amber-600 flex-shrink-0" />
                <div>
                  <strong className="text-amber-700">CRITICAL TO PREVENT DUPLICATES:</strong> In your SheetDB API settings, set the <code className="font-mono">ID</code> column as the 'Key'. This allows the system to update existing rows instead of creating new ones.
                </div>
              </div>
            </div>
          </details>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sheet API URL</label>
              <input type="url" value={sheetApiUrl} onChange={(e) => setSheetApiUrl(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-dairy-500" placeholder="Paste your API URL from SheetDB" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Username <span className="text-gray-400">(Optional)</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input type="text" value={sheetApiUser} onChange={(e) => setSheetApiUser(e.target.value)} className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg" placeholder="For Basic Auth" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Password <span className="text-gray-400">(Optional)</span></label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input type="password" value={sheetApiPass} onChange={(e) => setSheetApiPass(e.target.value)} className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg" placeholder="For Basic Auth" />
                </div>
              </div>
            </div>
            <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
                <motion.button onClick={handleTestConnection} disabled={isTesting || !sheetApiUrl} className="w-full md:w-1/3 bg-gray-200 text-gray-800 py-3 rounded-lg font-medium flex justify-center items-center space-x-2 disabled:opacity-50" whileTap={{ scale: 0.98 }}>
                    {isTesting ? <Loader2 className="animate-spin" /> : <><PlugZap size={20} /><span>Test</span></>}
                </motion.button>
                <motion.button onClick={handleSyncToGoogleSheet} disabled={isSyncing || dataLoading || !sheetApiUrl} className="w-full md:w-2/3 bg-blue-600 text-white py-3 rounded-lg font-medium flex justify-center items-center space-x-2 disabled:opacity-50" whileTap={{ scale: 0.98 }}>
                    {isSyncing ? <Loader2 className="animate-spin" /> : <><Share2 size={20} /><span>Sync to Sheets</span></>}
                </motion.button>
            </div>
          </div>
          <AnimatePresence>
            {testStatus && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={`mt-4 p-3 rounded-lg flex items-start space-x-3 text-sm ${testStatus.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {testStatus.type === 'success' ? <Check size={20} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />}
                <p>{testStatus.message}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {syncStatus && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={`mt-4 p-3 rounded-lg flex items-start space-x-3 text-sm ${syncStatus.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {syncStatus.type === 'success' ? <Check size={20} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />}
                <p>{syncStatus.message}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

      </div>
    </Layout>
  );
};

export default Statement;
